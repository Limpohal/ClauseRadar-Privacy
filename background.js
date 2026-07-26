// ClauseRadar background service worker
//
// IMPORTANT — chrome.sidePanel.open() must be called synchronously in direct
// response to a user gesture. Any await/promise before it breaks the gesture chain.
//
// The action.onClicked handler is NOT needed here because manifest.json already
// sets side_panel.default_path — Chrome auto-opens the panel on toolbar click.
//
// API proxying: sidepanel pages cannot reliably fetch() external URLs even with
// host_permissions. We proxy all API calls through this service worker, which
// has full network access.

const MENU_ID = "clauseradar-classify";
const DEFAULT_BACKEND = "https://clauseradar.ahali-clauseradar.workers.dev";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Classify regulatory impact",
    contexts: ["selection"]
  });

  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
});

// ── Keyboard shortcut: open panel + classify selection ──────────────────────────
chrome.commands.onCommand.addListener((command) => {
  if (command !== "classify-selection") return;

  // Get the active tab in the current window
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id || !tab?.windowId) return;

    // Execute script to get the current selection
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection().toString()
    }, (results) => {
      const selectionText = results?.[0]?.result?.trim();
      if (!selectionText) return;

      // Open side panel (must be synchronous with user gesture)
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});

      // Store selection for the side panel to pick up
      chrome.storage.local.set({
        pendingSelection: {
          text: selectionText,
          sourceUrl: tab.url || "",
          capturedAt: Date.now()
        }
      });
    });
  });
});

// ── Context menu: stash selection + open side panel ──────────────────────────
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;
  if (tab?.windowId == null) return;

  chrome.sidePanel.open({ windowId: tab.windowId })
    .catch(() => {});

  chrome.storage.local.set({
    pendingSelection: {
      text: info.selectionText,
      sourceUrl: tab.url || "",
      capturedAt: Date.now()
    }
  });
});

// ── API proxy: sidepanel → service worker → internet ─────────────────────────
// The sidepanel sends { type, payload } and we forward it to the backend.
// This avoids "Failed to fetch" caused by MV3 extension-page CORS restrictions.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "analyze") return false; // not ours

  (async () => {
    try {
      const { backendUrl, deviceId, payload } = msg;
      const base = (backendUrl || DEFAULT_BACKEND).replace(/\/$/, "");
      const url = `${base}/v1/analyze`;
      console.log("[ClauseRadar] Proxying request to:", url);
      
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Device-Id": deviceId
        },
        body: JSON.stringify(payload)
      });

      console.log("[ClauseRadar] Response status:", res.status);
      const quota = res.status === 429 ? null : undefined;
      const body = await res.text().catch(() => "");
      let data;
      try { data = JSON.parse(body); } catch { data = { raw: body }; }

      sendResponse({
        ok: res.ok || res.status === 429,
        status: res.status,
        data
      });
    } catch (err) {
      console.error("[ClauseRadar] Fetch error:", err);
      sendResponse({
        ok: false,
        status: 0,
        error: err.message || "Network error"
      });
    }
  })();

  return true; // keep channel open for async sendResponse
});
