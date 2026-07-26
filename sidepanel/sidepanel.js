// ClauseRadar side panel logic

const DEFAULT_BACKEND = "https://clauseradar.ahali-clauseradar.workers.dev";

// ---------- Tabs ----------
const tabs = document.querySelectorAll(".tab");
const panels = {
  classify: document.getElementById("panel-classify"),
  compare: document.getElementById("panel-compare"),
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

// ---------- Classify tab ----------
const classifyInput = document.getElementById("classify-input");
const classifyRunBtn = document.getElementById("classify-run");
const classifyResult = document.getElementById("classify-result");

function renderStamp(container, { level, rationale, excerpt }) {
  const levelClass = (level || "administrative").toLowerCase();
  container.innerHTML = `
    <div class="stamp-card">
      <span class="stamp ${levelClass}">${level}</span>
      <p class="stamp-rationale">${escapeHtml(rationale)}</p>
      ${excerpt ? `<p class="stamp-excerpt">${escapeHtml(truncate(excerpt, 220))}</p>` : ""}
    </div>
  `;
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

// ---------- Compare tab ----------
const compareA = document.getElementById("compare-a");
const compareB = document.getElementById("compare-b");
const compareRunBtn = document.getElementById("compare-run");
const compareResult = document.getElementById("compare-result");

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
  `;
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
