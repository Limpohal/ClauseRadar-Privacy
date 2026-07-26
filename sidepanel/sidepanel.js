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
async function getBackendUrl() {
  const { backendUrl } = await chrome.storage.local.get("backendUrl");
  return backendUrl || DEFAULT_BACKEND;
}

// ── Proxy API through background service worker ──────────────────────────────
// MV3 extension pages cannot reliably fetch() external URLs even with
// host_permissions. The service worker has full network access and proxies for us.
async function callBackend(payload) {
  const backendUrl = await getBackendUrl();
  if (!backendUrl) {
    throw new Error("No backend URL configured. Set it in the Settings tab.");
  }
  const deviceId = await getDeviceId();

  const response = await chrome.runtime.sendMessage({
    type: "analyze",
    backendUrl,
    deviceId,
    payload
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

function renderDocReport(container, sections) {
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
    const tableRows = rows.map(r => `
      <tr data-level="${(r.level || "administrative").toLowerCase()}">
        <td>${escapeHtml(r.clause || "")}</td>
        <td>${escapeHtml(r.change || "")}</td>
        <td><span class="diff-tag ${(r.level || "administrative").toLowerCase()}">${escapeHtml(r.level || "")}</span></td>
      </tr>
    `).join("");

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

function attachReportListeners(container, sections) {
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
  }

  searchInput?.addEventListener("input", applyFilters);
  levelCheckboxes.forEach(cb => cb.addEventListener("change", applyFilters));

  // Copy as Markdown
  container.querySelector("#doc-report-copy")?.addEventListener("click", () => {
    const md = buildMarkdownReport(sections);
    navigator.clipboard.writeText(md);
    flashButton(container.querySelector("#doc-report-copy"), "Copied!");
  });

  // Download as .md file
  container.querySelector("#doc-report-download")?.addEventListener("click", () => {
    const md = buildMarkdownReport(sections);
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
        md += `### ${r.clause || "Change"}\n**Impact:** ${r.level}\n\n**Change:** ${r.change}\n\n---\n`;
      });
    } else {
      md += `*No significant changes detected.*\n\n---\n`;
    }
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

// ---------- Classify tab ----------
const classifyInput = document.getElementById("classify-input");
const classifyRunBtn = document.getElementById("classify-run");
const classifyResult = document.getElementById("classify-result");

// Classify input: autosave draft
classifyInput.addEventListener("input", () => {
  debouncedSaveDraft(DRAFT_CLASSIFY_KEY, classifyInput.value);
});

function renderStamp(container, { level, rationale, excerpt }) {
  const levelClass = (level || "administrative").toLowerCase();
  container.innerHTML = `
    <div class="stamp-card">
      <span class="stamp ${levelClass}">${level}</span>
      <p class="stamp-rationale">${escapeHtml(rationale)}</p>
      ${excerpt ? `<p class="stamp-excerpt">${escapeHtml(truncate(excerpt, 220))}</p>` : ""}
      <div class="stamp-actions">
        <button class="btn-secondary stamp-copy" data-level="${escapeHtml(level)}" data-rationale="${escapeHtml(rationale)}" data-excerpt="${escapeHtml(excerpt || "")}" title="Copy as Markdown">Copy as Markdown</button>
      </div>
    </div>
  `;

  // Attach copy handler
  container.querySelector(".stamp-copy").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const md = `## ClauseRadar — Classification\n\n**Level:** ${btn.dataset.level}\n\n**Rationale:** ${btn.dataset.rationale}\n\n**Excerpt:**\n> ${btn.dataset.excerpt.replace(/\n/g, "\n> ")}\n\n---\n*Classified ${new Date().toLocaleString()}*`;
    navigator.clipboard.writeText(md);
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
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
    const data = await callBackend({ mode: "classify", text });
    renderStamp(classifyResult, {
      level: data.level,
      rationale: data.rationale,
      excerpt: text
    });
    // Save to history
    await saveHistory({
      type: "classify",
      text,
      level: data.level,
      rationale: data.rationale,
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

function renderDiffTable(container, rows) {
  const body = rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.clause || "")}</td>
      <td>${escapeHtml(r.change || "")}</td>
      <td><span class="diff-tag ${(r.level || "administrative").toLowerCase()}">${escapeHtml(r.level || "")}</span></td>
    </tr>
  `).join("");
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
      md += `### ${row.clause || "Change"}\n**Impact:** ${row.level}\n\n**Change:** ${row.change}\n\n---\n`;
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
      const data = await callBackend({ mode: "diff-doc", textA, textB });
      renderDocReport(compareResult, data.sections || []);
      // Save to history
      await saveHistory({
        type: "diff-doc",
        textA,
        textB,
        sections: data.sections || []
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
    const data = await callBackend({ mode: "diff", textA, textB });
    renderDiffTable(compareResult, data.rows || []);
    // Save to history
    await saveHistory({
      type: "diff",
      textA,
      textB,
      rows: data.rows || []
    });
    refreshHistory();
  } catch (err) {
    compareResult.innerHTML = `<p class="status-line error">${escapeHtml(err.message)}</p>`;
  } finally {
    compareRunBtn.disabled = false;
  }
});

// ---------- Settings tab ----------
const backendUrlInput = document.getElementById("backend-url");
const settingsSaveBtn = document.getElementById("settings-save");
const settingsStatus = document.getElementById("settings-status");

async function loadSettings() {
  backendUrlInput.value = await getBackendUrl();
}
loadSettings();

settingsSaveBtn.addEventListener("click", async () => {
  const url = backendUrlInput.value.trim();
  await chrome.storage.local.set({ backendUrl: url });
  settingsStatus.textContent = "Saved.";
  settingsStatus.className = "status-line ok";
  setTimeout(() => { settingsStatus.textContent = ""; }, 2000);
});
