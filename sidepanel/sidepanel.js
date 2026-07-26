// ClauseRadar side panel logic

const DEFAULT_BACKEND = "https://clauseradar.ahali-clauseradar.workers.dev";

// ---------- Tabs ----------
const tabs = document.querySelectorAll(".tab");
const panels = {
  classify: document.getElementById("panel-classify"),
  compare: document.getElementById("panel-compare"),
  history: document.getElementById("panel-history"),
  settings: document.getElementById("panel-settings")
};

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.setAttribute("aria-selected", "false"));
    Object.values(panels).forEach((p) => p.setAttribute("data-active", "false"));
    tab.setAttribute("aria-selected", "true");
    panels[tab.dataset.tab].setAttribute("data-active", "true");
  });
});

// ---------- Device id (anonymous, used for rate limiting only) ----------
async function getDeviceId() {
  const { deviceId } = await chrome.storage.local.get("deviceId");
  if (deviceId) return deviceId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ deviceId: id });
  return id;
}

// ---------- Backend URL ----------
function getBackendUrl() {
  return DEFAULT_BACKEND;
}

// ---------- Framework setting (multi-select) ----------
const FRAMEWORKS_KEY = "clauseradar_frameworks";

async function getFrameworks() {
  const { frameworks } = await chrome.storage.local.get(FRAMEWORKS_KEY);
  return frameworks || ["EU MDR"];
}

async function saveFrameworks(frameworks) {
  await chrome.storage.local.set({ [FRAMEWORKS_KEY]: frameworks });
}

function initFrameworkCheckboxes(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  const checkboxes = container.querySelectorAll('input[name="framework"]');
  
  // Load saved frameworks
  getFrameworks().then(saved => {
    checkboxes.forEach(cb => {
      cb.checked = saved.includes(cb.value);
    });
  });
  
  // Save on change
  checkboxes.forEach(cb => {
    cb.addEventListener("change", async () => {
      const selected = Array.from(container.querySelectorAll('input[name="framework"]:checked'))
        .map(cb => cb.value);
      await saveFrameworks(selected);
    });
  });
  
  return container;
}

function getSelectedFrameworks(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return ["EU MDR"];
  return Array.from(container.querySelectorAll('input[name="framework"]:checked'))
    .map(cb => cb.value);
}

// ── Proxy API through background service worker ──────────────────────────────
// MV3 extension pages cannot reliably fetch() external URLs even with
// host_permissions. The service worker has full network access and proxies for us.
async function callBackend(payload, containerId) {
  const backendUrl = await getBackendUrl();
  if (!backendUrl) {
    throw new Error("No backend URL configured. Set it in the Settings tab.");
  }
  const deviceId = await getDeviceId();
  // Get frameworks from the specified container (Classify or Compare tab)
  const frameworks = containerId ? getSelectedFrameworks(containerId) : await getFrameworks();

  const response = await chrome.runtime.sendMessage({
    type: "analyze",
    backendUrl,
    deviceId,
    payload: { ...payload, frameworks }
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Daily free limit reached. Try again tomorrow, or upgrade for higher limits.");
    }
    const detail = response.data?.error || response.error || `Status ${response.status}`;
    throw new Error(`Backend error (${response.status}): ${detail}`);
  }

  updateQuotaDisplay(response.data.quota);
  return response.data;
}

function updateQuotaDisplay(quota) {
  if (!quota) return;
  const { used, limit } = quota;
  const countEl = document.getElementById("quota-count");
  const fillEl = document.getElementById("quota-fill");
  if (countEl) countEl.textContent = `${used} / ${limit}`;
  if (fillEl) fillEl.style.width = `${Math.min(100, (used / limit) * 100)}%`;
}

// ---------- History (local storage) ----------
const HISTORY_KEY = "clauseradar_history";
const MAX_HISTORY = 50;

async function saveHistory(entry) {
  const { [HISTORY_KEY]: history = [] } = await chrome.storage.local.get(HISTORY_KEY);
  const newEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    ...entry
  };
  const updated = [newEntry, ...history].slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ [HISTORY_KEY]: updated });
}

async function loadHistory() {
  const { [HISTORY_KEY]: history = [] } = await chrome.storage.local.get(HISTORY_KEY);
  return history;
}

async function clearHistory() {
  await chrome.storage.local.remove(HISTORY_KEY);
  renderHistory([]);
}

function formatTimestamp(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderHistory(history) {
  const listEl = document.getElementById("history-list");
  const emptyEl = document.getElementById("history-empty");
  const clearBtn = document.getElementById("history-clear");

  if (!history.length) {
    listEl.innerHTML = "";
    emptyEl.style.display = "block";
    clearBtn.style.display = "none";
    return;
  }

  emptyEl.style.display = "none";
  clearBtn.style.display = "inline-block";

  listEl.innerHTML = history.map((item) => {
    const isClassify = item.type === "classify";
    const level = isClassify ? item.level : (item.rows?.[0]?.level || "mixed");
    const levelClass = (level || "administrative").toLowerCase();
    const preview = isClassify
      ? truncate(item.text || "", 120)
      : `${item.rows?.length || 0} changes`;

    return `
      <div class="history-item" data-id="${item.id}">
        <div class="history-header">
          <span class="history-type">${isClassify ? "Classify" : "Compare"}</span>
          <span class="history-time">${formatTimestamp(item.timestamp)}</span>
        </div>
        <div class="history-preview">
          <span class="history-stamp ${levelClass}">${level || "—"}</span>
          <span class="history-text">${escapeHtml(preview)}</span>
        </div>
        ${item.sourceUrl ? `<a class="history-source" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(new URL(item.sourceUrl).hostname)}</a>` : ""}
        <div class="history-actions">
          <button class="history-copy" data-id="${item.id}" title="Copy as Markdown">Copy MD</button>
          <button class="history-delete" data-id="${item.id}" title="Delete">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  // Attach event listeners
  listEl.querySelectorAll(".history-copy").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyHistoryAsMarkdown(e.target.dataset.id);
    });
  });
  listEl.querySelectorAll(".history-delete").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteHistoryItem(e.target.dataset.id);
    });
  });
}

async function deleteHistoryItem(id) {
  const { [HISTORY_KEY]: history = [] } = await chrome.storage.local.get(HISTORY_KEY);
  const updated = history.filter((item) => item.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: updated });
  renderHistory(updated);
}

async function copyHistoryAsMarkdown(id) {
  const { [HISTORY_KEY]: history = [] } = await chrome.storage.local.get(HISTORY_KEY);
  const item = history.find((h) => h.id === id);
  if (!item) return;

  let md = "";
  if (item.type === "classify") {
    md = `## ClauseRadar — Classification\n\n**Level:** ${item.level}\n\n**Rationale:** ${item.rationale}\n\n**Excerpt:**\n> ${item.text?.replace(/\n/g, "\n> ") || ""}\n\n---\n*Classified ${new Date(item.timestamp).toLocaleString()}*`;
    if (item.sourceUrl) md += `\n*Source: ${item.sourceUrl}*`;
  } else {
    md = `## ClauseRadar — Comparison\n\n`;
    (item.rows || []).forEach((row) => {
      md += `### ${row.clause || "Change"}\n**Impact:** ${row.level}\n\n**Change:** ${row.change}\n\n---\n`;
    });
    md += `*Compared ${new Date(item.timestamp).toLocaleString()}*`;
  }

  await navigator.clipboard.writeText(md);
  // Brief visual feedback
  const btn = document.querySelector(`.history-copy[data-id="${id}"]`);
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }
}

async function refreshHistory() {
  const history = await loadHistory();
  renderHistory(history);
}

// Listen for storage changes from other contexts (e.g., background)
chrome.storage.onChanged.addListener((changes) => {
  if (changes[HISTORY_KEY]) {
    refreshHistory();
  }
});

// Initial load
refreshHistory();

// Clear history button
document.getElementById("history-clear")?.addEventListener("click", clearHistory);

// ---------- Compare mode toggle ----------
const clauseModeFields = document.getElementById("clause-mode-fields");
const documentModeFields = document.getElementById("document-mode-fields");
const compareHint = document.getElementById("compare-hint");
const compareDocA = document.getElementById("compare-doc-a");
const compareDocB = document.getElementById("compare-doc-b");

document.querySelectorAll('input[name="compare-mode"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const isDocument = radio.value === "document";
    clauseModeFields.style.display = isDocument ? "none" : "block";
    documentModeFields.style.display = isDocument ? "block" : "none";
    compareHint.textContent = isDocument
      ? "Paste two full documents. They will be auto-segmented into clauses and compared."
      : "Paste the old and new clause text to get a structured, significance-rated comparison.";
  });
});

// Draft autosave for document mode
const DRAFT_COMPARE_DOC_A_KEY = "clauseradar_draft_compare_doc_a";
const DRAFT_COMPARE_DOC_B_KEY = "clauseradar_draft_compare_doc_b";

compareDocA.addEventListener("input", () => {
  debouncedSaveDraft(DRAFT_COMPARE_DOC_A_KEY, compareDocA.value);
});
compareDocB.addEventListener("input", () => {
  debouncedSaveDraft(DRAFT_COMPARE_DOC_B_KEY, compareDocB.value);
});

// Load document drafts
async function loadDocumentDrafts() {
  const { [DRAFT_COMPARE_DOC_A_KEY]: docADraft = "", [DRAFT_COMPARE_DOC_B_KEY]: docBDraft = "" } = await chrome.storage.local.get([DRAFT_COMPARE_DOC_A_KEY, DRAFT_COMPARE_DOC_B_KEY]);
  if (docADraft) compareDocA.value = docADraft;
  if (docBDraft) compareDocB.value = docBDraft;
}
loadDocumentDrafts();

// ---- File upload handling ----
const fileInputA = document.getElementById("file-input-a");
const fileInputB = document.getElementById("file-input-b");
const dropZoneA = document.getElementById("drop-zone-a");
const dropZoneB = document.getElementById("drop-zone-b");
const fileNameDisplayA = document.getElementById("file-name-a");
const fileNameDisplayB = document.getElementById("file-name-b");

// Drag and drop handlers
function setupDropZone(dropZone, fileInput, fileNameDisplay, textarea, draftKey) {
  // Click to open file dialog
  dropZone.addEventListener("click", (e) => {
    if (e.target !== fileNameDisplay && !e.target.closest(".file-remove")) {
      fileInput.click();
    }
  });

  // Drag over
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file, fileInput, fileNameDisplay, textarea, draftKey);
  });

  // File input change
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file, fileInput, fileNameDisplay, textarea, draftKey);
  });

  // Remove file
  fileNameDisplay.addEventListener("click", (e) => {
    if (e.target.closest(".file-remove")) {
      e.stopPropagation();
      fileInput.value = "";
      textarea.value = "";
      fileNameDisplay.style.display = "none";
      clearDraft(draftKey);
    }
  });
}

async function handleFile(file, fileInput, fileNameDisplay, textarea, draftKey) {
  if (!file.type.match(/text\/plain|text\/markdown|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/pdf/)) {
    alert("Unsupported file type. Please use .txt, .md, .docx, or .pdf");
    fileInput.value = "";
    return;
  }

  fileNameDisplay.querySelector(".file-name").textContent = file.name;
  fileNameDisplay.style.display = "flex";

  try {
    let text = "";
    if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      // .docx - use global mammoth from local lib
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      text = result.value;
    } else if (file.type === "application/pdf") {
      // .pdf - dynamically import pdf.js ES module
      const pdfjsLib = await import(chrome.runtime.getURL("sidepanel/lib/pdf.min.mjs"));
      pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("sidepanel/lib/pdf.worker.min.mjs");
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const textPromises = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        textPromises.push(content.items.map(item => item.str).join(" "));
      }
      text = (await Promise.all(textPromises)).join("\n\n");
    } else {
      // .txt, .md
      text = await file.text();
    }

    textarea.value = text;
    debouncedSaveDraft(draftKey, text);
  } catch (err) {
    console.error("File read error:", err);
    alert("Failed to read file: " + err.message);
    fileInput.value = "";
    fileNameDisplay.style.display = "none";
  }
}

const dropZoneAKeys = { fileInput: fileInputA, fileNameDisplay: fileNameDisplayA, textarea: compareDocA, draftKey: DRAFT_COMPARE_DOC_A_KEY };
const dropZoneBKeys = { fileInput: fileInputB, fileNameDisplay: fileNameDisplayB, textarea: compareDocB, draftKey: DRAFT_COMPARE_DOC_B_KEY };

setupDropZone(dropZoneA, fileInputA, fileNameDisplayA, compareDocA, DRAFT_COMPARE_DOC_A_KEY);
setupDropZone(dropZoneB, fileInputB, fileNameDisplayB, compareDocB, DRAFT_COMPARE_DOC_B_KEY);

// ---- Document segmentation helper ----
function segmentDocument(text) {
  const lines = text.split(/\r?\n/);
  const segments = [];
  let currentSegment = [];
  let currentTitle = "Document Start";

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,3})\s+(.+)$/);
    const clauseMatch = line.match(/^(\d+(\.\d+)*\.?)\s+(.+)$/);
    const articleMatch = line.match(/^(Article|Section|Clause|Chapter)\s+\d+/i);

    if (headingMatch || clauseMatch || articleMatch) {
      if (currentSegment.length > 0) {
        segments.push({
          title: currentTitle,
          text: currentSegment.join("\n").trim()
        });
      }
      currentTitle = (headingMatch ? headingMatch[2] : (clauseMatch ? clauseMatch[1] : line.trim())).trim();
      currentSegment = [line];
    } else {
      currentSegment.push(line);
    }
  }
  if (currentSegment.length > 0) {
    segments.push({
      title: currentTitle,
      text: currentSegment.join("\n").trim()
    });
  }
  return segments.filter(s => s.text.length > 0);
}

// ---- Document compare report rendering ----
let currentReportSections = []; // store for filtering

function renderDocReport(container, data) {
  // Handle multi-framework response
  if (data.frameworks && Array.isArray(data.frameworks)) {
    return renderMultiFrameworkDocReport(container, data.frameworks);
  }
  
  // Single framework (backward compatibility)
  const sections = data.sections || [];
  return renderSingleFrameworkDocReport(container, sections);
}

function renderSingleFrameworkDocReport(container, sections) {
  if (!sections.length) {
    container.innerHTML = `<p class="status-line">No comparable segments found.</p>`;
    return;
  }

  currentReportSections = sections;

  // Compute statistics
  const stats = computeReportStats(sections);

  // Build filter toolbar
  const filterHtml = `
    <div class="doc-report-toolbar">
      <div class="doc-report-stats">
        <span class="stat"><span class="stat-value">${stats.totalSections}</span> sections</span>
        <span class="stat"><span class="stat-value">${stats.totalChanges}</span> changes</span>
        <span class="stat critical"><span class="stat-value">${stats.byLevel.critical}</span> Critical</span>
        <span class="stat minor"><span class="stat-value">${stats.byLevel.minor}</span> Minor</span>
        <span class="stat administrative"><span class="stat-value">${stats.byLevel.administrative}</span> Admin</span>
      </div>
      <div class="doc-report-filters">
        <input type="text" id="doc-report-search" placeholder="Search clauses, changes…" class="doc-report-search">
        <div class="doc-report-level-filters">
          <label><input type="checkbox" value="critical" checked> Critical</label>
          <label><input type="checkbox" value="minor" checked> Minor</label>
          <label><input type="checkbox" value="administrative" checked> Administrative</label>
        </div>
      </div>
    `;

  // Build sections HTML
  const sectionsHtml = buildSectionsHtml(sections);

  container.innerHTML = `
    ${filterHtml}
    <div class="doc-report">${sectionsHtml}</div>
    <div class="doc-report-actions">
      <button class="btn-secondary" id="doc-report-copy">Copy as Markdown</button>
      <button class="btn-secondary" id="doc-report-download">Download .md</button>
    </div>
  `;

  // Attach event listeners
  attachReportListeners(container, sections);
}

function renderMultiFrameworkDocReport(container, frameworks) {
  if (!frameworks.length) {
    container.innerHTML = `<p class="status-line">No comparable segments found.</p>`;
    return;
  }

  // Flatten all sections for stats
  let allSections = [];
  frameworks.forEach(fw => {
    (fw.sections || []).forEach(s => allSections.push({ ...s, framework: fw.framework }));
  });
  currentReportSections = allSections;

  // Compute statistics
  const stats = computeReportStats(allSections);

  // Build filter toolbar
  const filterHtml = `
    <div class="doc-report-toolbar">
      <div class="doc-report-stats">
        <span class="stat"><span class="stat-value">${stats.totalSections}</span> sections</span>
        <span class="stat"><span class="stat-value">${stats.totalChanges}</span> changes</span>
        <span class="stat critical"><span class="stat-value">${stats.byLevel.critical}</span> Critical</span>
        <span class="stat minor"><span class="stat-value">${stats.byLevel.minor}</span> Minor</span>
        <span class="stat administrative"><span class="stat-value">${stats.byLevel.administrative}</span> Admin</span>
      </div>
      <div class="doc-report-filters">
        <input type="text" id="doc-report-search" placeholder="Search clauses, changes…" class="doc-report-search">
        <div class="doc-report-level-filters">
          <label><input type="checkbox" value="critical" checked> Critical</label>
          <label><input type="checkbox" value="minor" checked> Minor</label>
          <label><input type="checkbox" value="administrative" checked> Administrative</label>
        </div>
      </div>
    `;

  // Build sections HTML per framework
  let sectionsHtml = '';
  frameworks.forEach(fw => {
    sectionsHtml += `<div class="framework-report-section"><h3>${escapeHtml(fw.framework)}</h3>`;
    sectionsHtml += buildSectionsHtml(fw.sections || []);
    sectionsHtml += '</div>';
  });

  container.innerHTML = `
    ${filterHtml}
    <div class="doc-report multi-framework">${sectionsHtml}</div>
    <div class="doc-report-actions">
      <button class="btn-secondary" id="doc-report-copy">Copy as Markdown</button>
      <button class="btn-secondary" id="doc-report-download">Download .md</button>
    </div>
  `;

  // Attach event listeners (need to handle multi-framework)
  attachReportListeners(container, allSections, frameworks);
}

function computeReportStats(sections) {
  const stats = {
    totalSections: sections.length,
    totalChanges: 0,
    byLevel: { critical: 0, minor: 0, administrative: 0 }
  };
  sections.forEach(s => {
    (s.rows || []).forEach(r => {
      stats.totalChanges++;
      const lvl = (r.level || "administrative").toLowerCase();
      if (stats.byLevel[lvl] !== undefined) stats.byLevel[lvl]++;
    });
  });
  return stats;
}

function buildSectionsHtml(sections) {
  return sections.map((section, idx) => {
    const rows = section.rows || [];
    const topLevel = section.topLevel || section.title || `Section ${idx + 1}`;
    const worstLevel = rows.length > 0
      ? rows.reduce((worst, r) => {
          const order = { critical: 3, minor: 2, administrative: 1 };
          return order[r.level?.toLowerCase()] > order[worst.level?.toLowerCase()] ? r : worst;
        }, { level: "administrative" }).level
      : "administrative";
    const stampClass = worstLevel.toLowerCase();

    // Build table rows
    const tableRows = rows.map(r => {
      const badge = r.borderline ? `<span class="borderline-badge" title="Borderline classification">⚠</span>` : "";
      const confidenceLabel = r.confidence ? `<span class="confidence-badge confidence-${r.confidence}">${r.confidence.charAt(0).toUpperCase() + r.confidence.slice(1)}</span>` : "";
      const altLevels = r.alternativeLevels && r.alternativeLevels.length > 0 
        ? `<span class="alt-levels-badge" title="Alternative levels to consider">${r.alternativeLevels.join(", ")}</span>` 
        : "";
      const citationHtml = r.citation ? `<div class="diff-citation">Citation: ${escapeHtml(r.citation)}</div>` : "";
      return `
        <tr data-level="${(r.level || "administrative").toLowerCase()}">
          <td>${escapeHtml(r.clause || "")}</td>
          <td>${escapeHtml(r.change || "")}${citationHtml}</td>
          <td><span class="diff-tag ${(r.level || "administrative").toLowerCase()}">${escapeHtml(r.level || "")}</span> ${badge} ${confidenceLabel} ${altLevels}</td>
        </tr>
      `;
    }).join("");

    return `
      <details class="doc-report-section" ${idx === 0 ? "open" : ""}>
        <summary>
          <div class="doc-report-section-header">
            <span class="doc-report-section-title">${escapeHtml(topLevel)}</span>
            <span class="doc-report-section-stamp ${stampClass}">${escapeHtml(worstLevel)}</span>
          </div>
        </summary>
        <div class="doc-report-section-content">
          ${rows.length > 0 ? `
            <table class="doc-report-section-table">
              <thead><tr><th>Clause</th><th>What changed</th><th>Impact</th></tr></thead>
              <tbody>${tableRows}</tbody>
            </table>
          ` : `<p class="status-line">No significant changes detected.</p>`}
        </div>
      </details>
    `;
  }).join("");
}

function attachReportListeners(container, sections, frameworks) {
  const isMultiFramework = frameworks && Array.isArray(frameworks);

  // Search
  const searchInput = container.querySelector("#doc-report-search");
  const levelCheckboxes = container.querySelectorAll(".doc-report-level-filters input[type=checkbox]");

  function applyFilters() {
    const searchTerm = searchInput?.value.toLowerCase() || "";
    const activeLevels = Array.from(levelCheckboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value);

    const sectionElements = container.querySelectorAll(".doc-report-section");
    sectionElements.forEach((sectionEl, idx) => {
      const rows = sectionEl.querySelectorAll("tbody tr");
      let anyVisible = false;
      rows.forEach(row => {
        const level = row.dataset.level;
        const text = row.textContent.toLowerCase();
        const matchesSearch = !searchTerm || text.includes(searchTerm);
        const matchesLevel = activeLevels.includes(level);
        row.style.display = matchesSearch && matchesLevel ? "" : "none";
        if (matchesSearch && matchesLevel) anyVisible = true;
      });
      sectionEl.style.display = anyVisible ? "" : "none";
    }

  searchInput?.addEventListener("input", applyFilters);
  levelCheckboxes.forEach(cb => cb.addEventListener("change", applyFilters));

  // Copy as Markdown
  container.querySelector("#doc-report-copy")?.addEventListener("click", () => {
    const md = isMultiFramework ? buildMultiFrameworkMarkdownReport(frameworks) : buildMarkdownReport(sections);
    navigator.clipboard.writeText(md);
    flashButton(container.querySelector("#doc-report-copy"), "Copied!");
  });

  // Download as .md file
  container.querySelector("#doc-report-download")?.addEventListener("click", () => {
    const md = isMultiFramework ? buildMultiFrameworkMarkdownReport(frameworks) : buildMarkdownReport(sections);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clauseradar-comparison-${new Date().toISOString().slice(0,10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    flashButton(container.querySelector("#doc-report-download"), "Downloaded!");
  });
}

function buildMarkdownReport(sections) {
  let md = `# ClauseRadar — Document Comparison\n\n`;
  const stats = computeReportStats(sections);
  md += `*Sections: ${stats.totalSections} | Changes: ${stats.totalChanges} (Critical: ${stats.byLevel.critical}, Minor: ${stats.byLevel.minor}, Admin: ${stats.byLevel.administrative})*\n\n---\n\n`;
  sections.forEach(s => {
    md += `## ${s.topLevel || s.title || "Section"}\n\n`;
    if (s.rows && s.rows.length > 0) {
      s.rows.forEach(r => {
        md += `### ${r.clause || "Change"}\n**Impact:** ${r.level}\n\n**Change:** ${r.change}\n\n`;
        if (r.citation) md += `**Citation:** ${r.citation}\n\n`;
        if (r.confidence) md += `**Confidence:** ${r.confidence.charAt(0).toUpperCase() + r.confidence.slice(1)}\n\n`;
        if (r.borderline) md += `**Borderline:** Yes\n\n`;
        if (r.alternativeLevels && r.alternativeLevels.length > 0) md += `**Alternative levels to consider:** ${r.alternativeLevels.join(", ")}\n\n`;
        md += `---\n`;
      });
    } else {
      md += `*No significant changes detected.*\n\n---\n`;
    }
  });
  md += `\n*Compared ${new Date().toLocaleString()}*`;
  return md;
}

function buildMultiFrameworkMarkdownReport(frameworks) {
  let md = `# ClauseRadar — Document Comparison (Multi-Framework)\n\n`;
  let totalSections = 0, totalChanges = 0;
  const byLevel = { critical: 0, minor: 0, administrative: 0 };
  
  frameworks.forEach(fw => {
    const stats = computeReportStats(fw.sections || []);
    totalSections += stats.totalSections;
    totalChanges += stats.totalChanges;
    byLevel.critical += stats.byLevel.critical;
    byLevel.minor += stats.byLevel.minor;
    byLevel.administrative += stats.byLevel.administrative;
  });
  
  md += `*Frameworks: ${frameworks.map(f => f.framework).join(", ")} | Sections: ${totalSections} | Changes: ${totalChanges} (Critical: ${byLevel.critical}, Minor: ${byLevel.minor}, Admin: ${byLevel.administrative})*\n\n---\n\n`;
  
  frameworks.forEach(fw => {
    md += `# ${escapeHtml(fw.framework)}\n\n`;
    (fw.sections || []).forEach(s => {
      md += `## ${s.topLevel || s.title || "Section"}\n\n`;
      if (s.rows && s.rows.length > 0) {
        s.rows.forEach(r => {
          md += `### ${r.clause || "Change"}\n**Impact:** ${r.level}\n\n**Change:** ${r.change}\n\n`;
          if (r.citation) md += `**Citation:** ${r.citation}\n\n`;
          if (r.confidence) md += `**Confidence:** ${r.confidence.charAt(0).toUpperCase() + r.confidence.slice(1)}\n\n`;
          if (r.borderline) md += `**Borderline:** Yes\n\n`;
          if (r.alternativeLevels && r.alternativeLevels.length > 0) md += `**Alternative levels to consider:** ${r.alternativeLevels.join(", ")}\n\n`;
          md += `---\n`;
        });
      } else {
        md += `*No significant changes detected.*\n\n---\n`;
      }
    });
  });
  md += `\n*Compared ${new Date().toLocaleString()}*`;
  return md;
}

function flashButton(btn, text) {
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = orig; }, 1500);
}

// Compare inputs: autosave drafts
const DRAFT_CLASSIFY_KEY = "clauseradar_draft_classify";
const DRAFT_COMPARE_A_KEY = "clauseradar_draft_compare_a";
const DRAFT_COMPARE_B_KEY = "clauseradar_draft_compare_b";
const DRAFT_DEBOUNCE_MS = 500;

let draftTimers = { classify: null, compareA: null, compareB: null };

async function loadDrafts() {
  const { [DRAFT_CLASSIFY_KEY]: classifyDraft = "", [DRAFT_COMPARE_A_KEY]: compareADraft = "", [DRAFT_COMPARE_B_KEY]: compareBDraft = "" } = await chrome.storage.local.get([DRAFT_CLASSIFY_KEY, DRAFT_COMPARE_A_KEY, DRAFT_COMPARE_B_KEY]);
  if (classifyDraft) classifyInput.value = classifyDraft;
  if (compareADraft) compareA.value = compareADraft;
  if (compareBDraft) compareB.value = compareBDraft;
}

function saveDraft(key, value) {
  chrome.storage.local.set({ [key]: value });
}

function debouncedSaveDraft(key, value) {
  clearTimeout(draftTimers[key]);
  draftTimers[key] = setTimeout(() => saveDraft(key, value), DRAFT_DEBOUNCE_MS);
}

function clearDraft(key) {
  chrome.storage.local.remove(key);
}

function clearAllDrafts() {
  clearDraft(DRAFT_CLASSIFY_KEY);
  clearDraft(DRAFT_COMPARE_A_KEY);
  clearDraft(DRAFT_COMPARE_B_KEY);
}

// Load drafts on startup
loadDrafts();

// Initialize framework checkboxes for Classify and Compare tabs
initFrameworkCheckboxes("panel-classify");
initFrameworkCheckboxes("panel-compare");

// ---------- Classify tab ----------
const classifyInput = document.getElementById("classify-input");
const classifyRunBtn = document.getElementById("classify-run");
const classifyResult = document.getElementById("classify-result");

// Classify input: autosave draft
classifyInput.addEventListener("input", () => {
  debouncedSaveDraft(DRAFT_CLASSIFY_KEY, classifyInput.value);
});

function renderStamp(container, data) {
  // Check if multi-framework response
  if (data.frameworks && Array.isArray(data.frameworks)) {
    return renderMultiFrameworkStamp(container, data.frameworks, data.excerpt);
  }
  
  // Single framework (backward compatibility)
  const { level, rationale, citation, confidence, borderline, alternativeLevels, excerpt } = data;
  return renderSingleFrameworkStamp(container, { level, rationale, citation, confidence, borderline, alternativeLevels, excerpt });
}

function renderSingleFrameworkStamp(container, { level, rationale, citation, confidence, borderline, alternativeLevels, excerpt, framework }) {
  const levelClass = (level || "administrative").toLowerCase();
  const confClass = (confidence || "medium").toLowerCase();
  const confLabel = confidence ? confidence.charAt(0).toUpperCase() + confidence.slice(1) : "Medium";
  const borderlineBadge = borderline ? `<span class="stamp-badge borderline" title="Borderline classification — could reasonably be another level">⚠ Borderline</span>` : "";
  const altLevels = alternativeLevels && alternativeLevels.length > 0 
    ? `<span class="stamp-badge alt-levels" title="Alternative levels to consider">${alternativeLevels.join(", ")}</span>` : "";
  const frameworkBadge = framework ? `<span class="stamp-badge framework" title="Framework">${escapeHtml(framework)}</span>` : "";

  container.innerHTML = `
    <div class="stamp-card">
      <span class="stamp ${levelClass}">${level}</span>
      ${frameworkBadge}
      ${borderlineBadge}
      ${altLevels}
      <p class="stamp-rationale">${escapeHtml(rationale)}</p>
      ${citation ? `<p class="stamp-citation"><strong>Citation:</strong> ${escapeHtml(citation)}</p>` : ""}
      <div class="stamp-meta">
        <span class="confidence ${confClass}" title="Model confidence">Confidence: ${confLabel}</span>
      </div>
      ${excerpt ? `<p class="stamp-excerpt">${escapeHtml(truncate(excerpt, 220))}</p>` : ""}
      <div class="stamp-actions">
        <button class="btn-secondary stamp-copy" 
          data-level="${escapeHtml(level)}" 
          data-rationale="${escapeHtml(rationale)}" 
          data-citation="${escapeHtml(citation || "")}"
          data-confidence="${escapeHtml(confidence || "")}"
          data-borderline="${borderline}"
          data-alternative-levels="${escapeHtml((alternativeLevels || []).join(", "))}"
          data-framework="${escapeHtml(framework || "")}"
          data-excerpt="${escapeHtml(excerpt || "")}" 
          title="Copy as Markdown">Copy as Markdown</button>
        <button class="btn-secondary stamp-override" title="Override classification">Override</button>
      </div>
    </div>
  `;

  // Attach copy handler
  container.querySelector(".stamp-copy").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const md = buildClassifyMarkdown({
      level: btn.dataset.level,
      rationale: btn.dataset.rationale,
      citation: btn.dataset.citation,
      confidence: btn.dataset.confidence,
      borderline: btn.dataset.borderline === "true",
      alternativeLevels: btn.dataset.alternativeLevels ? btn.dataset.alternativeLevels.split(", ").filter(Boolean) : [],
      framework: btn.dataset.framework,
      excerpt: btn.dataset.excerpt
    });
    navigator.clipboard.writeText(md);
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });

  // Attach override handler
  container.querySelector(".stamp-override").addEventListener("click", (e) => {
    showOverrideDialog(container, {
      level: container.querySelector(".stamp").textContent,
      rationale,
      citation,
      confidence,
      borderline,
      alternativeLevels,
      framework,
      excerpt: excerpt
    });
  });
}

function renderMultiFrameworkStamp(container, frameworks, excerpt) {
  let html = `<div class="stamp-card multi-framework">`;
  
  frameworks.forEach(fw => {
    const levelClass = (fw.level || "administrative").toLowerCase();
    const confClass = (fw.confidence || "medium").toLowerCase();
    const confLabel = fw.confidence ? fw.confidence.charAt(0).toUpperCase() + fw.confidence.slice(1) : "Medium";
    const borderlineBadge = fw.borderline ? `<span class="stamp-badge borderline" title="Borderline classification — could reasonably be another level">⚠ Borderline</span>` : "";
    const altLevels = fw.alternativeLevels && fw.alternativeLevels.length > 0 
      ? `<span class="stamp-badge alt-levels" title="Alternative levels to consider">${fw.alternativeLevels.join(", ")}</span>` : "";
    const frameworkBadge = `<span class="stamp-badge framework" title="Framework">${escapeHtml(fw.framework)}</span>`;
    
    html += `
      <div class="framework-result">
        <span class="stamp ${levelClass}">${fw.level}</span>
        ${frameworkBadge}
        ${borderlineBadge}
        ${altLevels}
        <p class="stamp-rationale">${escapeHtml(fw.rationale)}</p>
        ${fw.citation ? `<p class="stamp-citation"><strong>Citation:</strong> ${escapeHtml(fw.citation)}</p>` : ""}
        <div class="stamp-meta">
          <span class="confidence ${confClass}" title="Model confidence">Confidence: ${confLabel}</span>
        </div>
      </div>
    `;
  });
  
  if (excerpt) {
    html += `<p class="stamp-excerpt">${escapeHtml(truncate(excerpt, 220))}</p>`;
  }
  
  html += `
    <div class="stamp-actions">
      <button class="btn-secondary stamp-copy" 
        data-multi-framework="true"
        data-excerpt="${escapeHtml(excerpt || "")}" 
        title="Copy as Markdown">Copy as Markdown</button>
      <button class="btn-secondary stamp-override" title="Override classification">Override</button>
    </div>
  </div>`;
  
  container.innerHTML = html;
  
  // Attach copy handler for multi-framework
  container.querySelector(".stamp-copy").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const md = buildMultiFrameworkMarkdown(frameworks, btn.dataset.excerpt);
    navigator.clipboard.writeText(md);
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
  
  // Attach override handler
  container.querySelector(".stamp-override").addEventListener("click", (e) => {
    // For multi-framework, use the first framework for override dialog
    const firstFw = frameworks[0];
    showOverrideDialog(container, {
      level: firstFw.level,
      rationale: firstFw.rationale,
      citation: firstFw.citation,
      confidence: firstFw.confidence,
      borderline: firstFw.borderline,
      alternativeLevels: firstFw.alternativeLevels,
      framework: firstFw.framework,
      excerpt: excerpt
    });
  });
}

function buildMultiFrameworkMarkdown(frameworks, excerpt) {
  let md = `## ClauseRadar — Classification (Multi-Framework)\n\n`;
  
  frameworks.forEach(fw => {
    md += `### ${escapeHtml(fw.framework)}\n\n`;
    md += `**Level:** ${fw.level}\n\n`;
    md += `**Rationale:** ${fw.rationale}\n\n`;
    if (fw.citation) md += `**Citation:** ${fw.citation}\n\n`;
    if (fw.confidence) md += `**Confidence:** ${fw.confidence.charAt(0).toUpperCase() + fw.confidence.slice(1)}\n\n`;
    if (fw.borderline) md += `**Borderline:** Yes\n\n`;
    if (fw.alternativeLevels && fw.alternativeLevels.length > 0) md += `**Alternative levels to consider:** ${fw.alternativeLevels.join(", ")}\n\n`;
  });
  
  if (excerpt) md += `**Excerpt:**\n> ${excerpt.replace(/\n/g, "\n> ")}\n\n`;
  md += `---\n*Classified ${new Date().toLocaleString()}*`;
  return md;
}

function buildClassifyMarkdown({ level, rationale, citation, confidence, borderline, alternativeLevels, framework, excerpt }) {
  let md = `## ClauseRadar — Classification\n\n`;
  if (framework) md += `**Framework:** ${framework}\n\n`;
  md += `**Level:** ${level}\n\n`;
  md += `**Rationale:** ${rationale}\n\n`;
  if (citation) md += `**Citation:** ${citation}\n\n`;
  if (confidence) md += `**Confidence:** ${confidence.charAt(0).toUpperCase() + confidence.slice(1)}\n\n`;
  if (borderline) md += `**Borderline:** Yes\n\n`;
  if (alternativeLevels && alternativeLevels.length > 0) md += `**Alternative levels to consider:** ${alternativeLevels.join(", ")}\n\n`;
  if (excerpt) md += `**Excerpt:**\n> ${excerpt.replace(/\n/g, "\n> ")}\n\n`;
  md += `---\n*Classified ${new Date().toLocaleString()}*`;
  return md;
}

function showOverrideDialog(container, original) {
  const overrideHtml = `
    <div class="override-dialog" style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border: 1px solid var(--rule); border-radius: var(--radius); padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 1000; max-width: 400px; width: 90%;">
      <div style="position: absolute; top: 10px; right: 10px; cursor: pointer; font-size: 18px;" onclick="this.closest('.override-dialog').remove()">×</div>
      <h3 style="margin-top: 0; font-family: 'IBM Plex Sans', sans-serif;">Override Classification</h3>
      <p style="font-size: 12px; color: var(--ink-soft); margin-bottom: 16px;">Original: <strong>${original.level}</strong> — ${original.rationale}</p>
      <label style="display: block; margin-bottom: 8px;">
        <span class="field-label">New Level</span>
        <select id="override-level" style="width: 100%; padding: 8px; border: 1px solid var(--rule); border-radius: var(--radius); font-family: inherit;">
          <option value="Critical" ${original.level === "Critical" ? "selected" : ""}>Critical</option>
          <option value="Minor" ${original.level === "Minor" ? "selected" : ""}>Minor</option>
          <option value="Administrative" ${original.level === "Administrative" ? "selected" : ""}>Administrative</option>
        </select>
      </label>
      <label style="display: block; margin-bottom: 8px;">
        <span class="field-label">Reason for Override</span>
        <textarea id="override-reason" placeholder="Explain why you're changing the classification..." style="width: 100%; min-height: 80px; padding: 8px; border: 1px solid var(--rule); border-radius: var(--radius); font-family: inherit;"></textarea>
      </label>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button class="btn-secondary" onclick="this.closest('.override-dialog').remove()">Cancel</button>
        <button class="btn-primary" id="override-confirm">Confirm Override</button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", overrideHtml);
  
  document.getElementById("override-confirm").addEventListener("click", () => {
    const newLevel = document.getElementById("override-level").value;
    const reason = document.getElementById("override-reason").value.trim();
    if (!reason) {
      alert("Please provide a reason for the override.");
      return;
    }
    document.querySelector(".override-dialog").remove();
    
    // Re-render stamp with override info
    renderStamp(container, {
      ...original,
      level: newLevel,
      rationale: `${original.rationale} [OVERRIDE: ${reason}]`,
      override: { originalLevel: original.level, reason, timestamp: new Date().toISOString() }
    });
    
    // Update history with override
    updateHistoryWithOverride(original.text || "", newLevel, reason, original.level);
  });
}

async function updateHistoryWithOverride(text, newLevel, reason, originalLevel) {
  const { [HISTORY_KEY]: history = [] } = await chrome.storage.local.get(HISTORY_KEY);
  const latest = history.find(h => h.type === "classify" && h.text === text);
  if (latest) {
    latest.level = newLevel;
    latest.rationale = `${latest.rationale} [OVERRIDE: ${reason}]`;
    latest.override = { originalLevel, reason, timestamp: new Date().toISOString() };
    await chrome.storage.local.set({ [HISTORY_KEY]: history });
    refreshHistory();
  }
}

function escapeHtml(str = "") {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function truncate(str, n) {
  return str.length > n ? str.slice(0, n).trim() + "\u2026" : str;
}

async function runClassify(text) {
  classifyRunBtn.disabled = true;
  classifyResult.innerHTML = `<p class="status-line">Classifying\u2026</p>`;
  try {
    const data = await callBackend({ mode: "classify", text }, "panel-classify");
    
    // Pass full data to renderStamp (it handles both single and multi-framework)
    renderStamp(classifyResult, { ...data, excerpt: text });
    
    // Save to history
    await saveHistory({
      type: "classify",
      text,
      ...data, // Include all data (single or multi-framework)
      sourceUrl: (await chrome.storage.local.get("pendingSelection")).pendingSelection?.sourceUrl || ""
    });
    refreshHistory();
  } catch (err) {
    classifyResult.innerHTML = `<p class="status-line error">${escapeHtml(err.message)}</p>`;
  } finally {
    classifyRunBtn.disabled = false;
  }
}

classifyRunBtn.addEventListener("click", () => {
  const text = classifyInput.value.trim();
  if (!text) {
    classifyResult.innerHTML = `<p class="status-line error">Paste or select a clause first.</p>`;
    return;
  }
  runClassify(text);
});

// Pull in a selection captured by the context menu, if any.
async function loadPendingSelection() {
  const { pendingSelection } = await chrome.storage.local.get("pendingSelection");
  if (pendingSelection?.text) {
    classifyInput.value = pendingSelection.text;
    await chrome.storage.local.remove("pendingSelection");
    runClassify(pendingSelection.text);
  }
}
loadPendingSelection();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.pendingSelection?.newValue) {
    loadPendingSelection();
  }
});

// Compare inputs: autosave drafts

// ---------- Compare tab ----------
const compareA = document.getElementById("compare-a");
const compareB = document.getElementById("compare-b");
const compareRunBtn = document.getElementById("compare-run");
const compareResult = document.getElementById("compare-result");

compareA.addEventListener("input", () => {
  debouncedSaveDraft(DRAFT_COMPARE_A_KEY, compareA.value);
});
compareB.addEventListener("input", () => {
  debouncedSaveDraft(DRAFT_COMPARE_B_KEY, compareB.value);
});

function renderDiffTable(container, data) {
  // Handle multi-framework response
  if (data.frameworks && Array.isArray(data.frameworks)) {
    return renderMultiFrameworkDiffTable(container, data.frameworks);
  }
  
  // Single framework (backward compatibility)
  const rows = data.rows || [];
  return renderSingleFrameworkDiffTable(container, rows);
}

function renderSingleFrameworkDiffTable(container, rows) {
  const body = rows.map((r) => {
    const badge = r.borderline ? `<span class="borderline-badge" title="Borderline classification">⚠</span>` : "";
    const confidenceLabel = r.confidence ? `<span class="confidence-badge confidence-${r.confidence}">${r.confidence.charAt(0).toUpperCase() + r.confidence.slice(1)}</span>` : "";
    const altLevels = r.alternativeLevels && r.alternativeLevels.length > 0 
      ? `<span class="alt-levels-badge" title="Alternative levels to consider">${r.alternativeLevels.join(", ")}</span>` 
      : "";
    return `
      <tr data-citation="${escapeHtml(r.citation || "")}">
        <td>${escapeHtml(r.clause || "")}</td>
        <td>${escapeHtml(r.change || "")}${r.citation ? `<div class="diff-citation">Citation: ${escapeHtml(r.citation)}</div>` : ""}</td>
        <td><span class="diff-tag ${(r.level || "administrative").toLowerCase()}">${escapeHtml(r.level || "")}</span> ${badge} ${confidenceLabel} ${altLevels}</td>
      </tr>
    `;
  }).join("");
  container.innerHTML = `
    <table class="diff-table">
      <thead><tr><th>Clause</th><th>What changed</th><th>Impact</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    <div class="diff-actions">
      <button class="btn-secondary diff-copy" title="Copy as Markdown">Copy as Markdown</button>
    </div>
  `;

  // Attach copy handler
  container.querySelector(".diff-copy").addEventListener("click", () => {
    let md = `## ClauseRadar — Comparison\n\n`;
    rows.forEach((row) => {
      md += `### ${row.clause || "Change"}\n**Impact:** ${row.level}\n\n**Change:** ${row.change}\n`;
      if (row.citation) md += `**Citation:** ${row.citation}\n`;
      if (row.confidence) md += `**Confidence:** ${row.confidence.charAt(0).toUpperCase() + row.confidence.slice(1)}\n`;
      if (row.borderline) md += `**Borderline:** Yes\n`;
      if (row.alternativeLevels && row.alternativeLevels.length > 0) md += `**Alternative levels to consider:** ${row.alternativeLevels.join(", ")}\n`;
      md += `\n---\n`;
    });
    md += `*Compared ${new Date().toLocaleString()}*`;
    navigator.clipboard.writeText(md);
    const btn = container.querySelector(".diff-copy");
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

function renderMultiFrameworkDiffTable(container, frameworks) {
  let html = `<div class="multi-framework-diff">`;
  
  frameworks.forEach(fw => {
    html += `<div class="framework-diff-section"><h4>${escapeHtml(fw.framework)}</h4>`;
    
    if (!fw.rows || fw.rows.length === 0) {
      html += `<p class="status-line">No significant changes detected.</p></div>`;
      return;
    }
    
    const body = fw.rows.map(r => {
      const badge = r.borderline ? `<span class="borderline-badge" title="Borderline classification">⚠</span>` : "";
      const confidenceLabel = r.confidence ? `<span class="confidence-badge confidence-${r.confidence}">${r.confidence.charAt(0).toUpperCase() + r.confidence.slice(1)}</span>` : "";
      const altLevels = r.alternativeLevels && r.alternativeLevels.length > 0 
        ? `<span class="alt-levels-badge" title="Alternative levels to consider">${r.alternativeLevels.join(", ")}</span>` 
        : "";
      return `
        <tr data-citation="${escapeHtml(r.citation || "")}">
          <td>${escapeHtml(r.clause || "")}</td>
          <td>${escapeHtml(r.change || "")}${r.citation ? `<div class="diff-citation">Citation: ${escapeHtml(r.citation)}</div>` : ""}</td>
          <td><span class="diff-tag ${(r.level || "administrative").toLowerCase()}">${escapeHtml(r.level || "")}</span> ${badge} ${confidenceLabel} ${altLevels}</td>
        </tr>
      `;
    }).join("");
    
    html += `
      <table class="diff-table">
        <thead><tr><th>Clause</th><th>What changed</th><th>Impact</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
  });
  
  html += `
    <div class="diff-actions">
      <button class="btn-secondary diff-copy" title="Copy as Markdown">Copy as Markdown</button>
    </div>
  </div>`;
  
  container.innerHTML = html;
  
  // Attach copy handler for multi-framework
  container.querySelector(".diff-copy").addEventListener("click", () => {
    let md = `## ClauseRadar — Comparison (Multi-Framework)\n\n`;
    frameworks.forEach(fw => {
      md += `### ${escapeHtml(fw.framework)}\n\n`;
      if (!fw.rows || fw.rows.length === 0) {
        md += `*No significant changes detected.*\n\n`;
        return;
      }
      fw.rows.forEach(row => {
        md += `#### ${row.clause || "Change"}\n**Impact:** ${row.level}\n\n**Change:** ${row.change}\n`;
        if (row.citation) md += `**Citation:** ${row.citation}\n`;
        if (row.confidence) md += `**Confidence:** ${row.confidence.charAt(0).toUpperCase() + row.confidence.slice(1)}\n`;
        if (row.borderline) md += `**Borderline:** Yes\n`;
        if (row.alternativeLevels && row.alternativeLevels.length > 0) md += `**Alternative levels to consider:** ${row.alternativeLevels.join(", ")}\n`;
        md += `\n---\n`;
      });
    });
    md += `*Compared ${new Date().toLocaleString()}*`;
    navigator.clipboard.writeText(md);
    const btn = container.querySelector(".diff-copy");
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

compareRunBtn.addEventListener("click", async () => {
  const isDocumentMode = document.querySelector('input[name="compare-mode"]:checked')?.value === "document";

  if (isDocumentMode) {
    // Document compare mode
    const textA = compareDocA.value.trim();
    const textB = compareDocB.value.trim();
    if (!textA || !textB) {
      compareResult.innerHTML = `<p class="status-line error">Paste both the previous and new documents.</p>`;
      return;
    }
    compareRunBtn.disabled = true;
    compareResult.innerHTML = `<p class="status-line">Segmenting and comparing documents\u2026</p>`;
    try {
      const data = await callBackend({ mode: "diff-doc", textA, textB }, "panel-compare");
      renderDocReport(compareResult, data);
      // Save to history
      await saveHistory({
        type: "diff-doc",
        textA,
        textB,
        ...data
      });
      refreshHistory();
    } catch (err) {
      compareResult.innerHTML = `<p class="status-line error">${escapeHtml(err.message)}</p>`;
    } finally {
      compareRunBtn.disabled = false;
    }
    return;
  }

  // Clause compare mode (existing)
  const textA = compareA.value.trim();
  const textB = compareB.value.trim();
  if (!textA || !textB) {
    compareResult.innerHTML = `<p class="status-line error">Paste both the previous and new text.</p>`;
    return;
  }
  compareRunBtn.disabled = true;
  compareResult.innerHTML = `<p class="status-line">Comparing versions\u2026</p>`;
  try {
    const data = await callBackend({ mode: "diff", textA, textB }, "panel-compare");
    renderDiffTable(compareResult, data);
    // Save to history
    await saveHistory({
      type: "diff",
      textA,
      textB,
      ...data
    });
    refreshHistory();
  } catch (err) {
    compareResult.innerHTML = `<p class="status-line error">${escapeHtml(err.message)}</p>`;
  } finally {
    compareRunBtn.disabled = false;
  }
});
