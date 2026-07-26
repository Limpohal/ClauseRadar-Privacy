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

// ---------- Draft autosave ----------
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
