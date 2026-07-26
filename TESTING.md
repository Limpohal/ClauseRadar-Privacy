# ClauseRadar — Manual Test Plan (Milestone 0)

Run through these four paths by hand after loading the unpacked extension in `chrome://extensions` and configuring the backend URL in Settings.

---

## 1. Classify — Happy Path

**Setup**
- Extension loaded, backend URL saved in Settings.
- Quota shows `0 / 20`.

**Steps**
1. Open any page with regulatory text (e.g., an FDA guidance page, MDR article, or just paste text).
2. Highlight a clause → right-click → **Classify regulatory impact**.
3. Side panel opens on **Classify** tab, text auto-fills, stamp renders.

**Expected**
- Stamp card appears with:
  - Level badge: **Critical** / **Minor** / **Administrative** (colored correctly)
  - One-sentence rationale
  - Truncated excerpt of the clause
- Quota updates to `1 / 20`, bar fills ~5%
- No errors in console

**Pass criteria**
- [ ] Stamp renders with correct level color
- [ ] Rationale is a single concise sentence
- [ ] Quota increments

---

## 2. Compare — Happy Path

**Setup**
- Same as above, quota ≥ 1.

**Steps**
1. Switch to **Compare** tab.
2. Paste an old clause version in "Previous edition".
3. Paste a modified version in "New edition".
4. Click **Compare versions**.

**Expected**
- Table renders with rows: `Clause` | `What changed` | `Impact`
- Each row has a colored tag: Critical / Minor / Administrative
- Quota increments again

**Pass criteria**
- [ ] Table renders with ≥ 1 row
- [ ] Each row has a valid level tag
- [ ] Quota increments

---

## 3. Rate-Limit Exceeded

**Setup**
- Use the same device (same `deviceId` in `chrome.storage.local`) until quota hits 20.

**Steps**
1. Repeat Classify or Compare until the 21st request.
2. Or temporarily lower `DAILY_LIMIT` in `worker/index.js` to 1, redeploy, then make 2 requests.

**Expected**
- Response status `429`
- UI shows: **"Daily free limit reached. Try again tomorrow, or upgrade for higher limits."**
- No stamp/table rendered
- Quota display shows `20 / 20` (or `1 / 1` if you lowered it)

**Pass criteria**
- [ ] 429 handled gracefully, no red console error
- [ ] User-friendly message shown
- [ ] Quota bar at 100%

---

## 4. Backend Unreachable

**Setup**
- In Settings, set Backend URL to an invalid host (e.g., `https://invalid.invalid`).
- Or disable network / block the Worker domain in DevTools.

**Steps**
1. Try Classify or Compare with any text.

**Expected**
- UI shows: **"Backend error (0): Network error"** (or similar)
- No crash, no uncaught exception in console
- Button re-enables after error

**Pass criteria**
- [ ] Error surfaced to UI, not just console
- [ ] Button re-enabled
- [ ] No stack trace visible to user

---

## Quick Smoke Test Checklist (run once after any deploy)

- [ ] Extension loads, side panel opens
- [ ] Settings saves backend URL
- [ ] Classify happy path works
- [ ] Compare happy path works
- [ ] Quota increments and persists across panel close/reopen
- [ ] Context menu → "Classify regulatory impact" opens panel with selection pre-filled