# ClauseRadar

An AI-assisted Chrome MV3 extension for regulatory affairs professionals: classify the
significance of a clause (Critical / Minor / Administrative) and compare two
versions of a clause, via a Cloudflare Worker backend that calls OpenRouter.

---

## Agent Instructions & Guardrails

> **These are binding constraints for any AI agent (Claude, Kimi Code, Copilot, etc.)
> working on this project. Do not violate without asking the human first.**

### Hard Constraints

1. **Never run `wrangler secret put`, `wrangler deploy`, or any command that touches
   production secrets or deploys the Worker**, without showing the command first and
   getting explicit confirmation.
2. **Never modify or read `.env` files, shell history, SSH keys, or anything outside
   this project's folder.**
3. **Before making any change**, confirm the working directory is a clean git state
   (no uncommitted changes) — or report that it isn't. If git isn't initialized yet,
   initialize it and make an initial commit before touching anything else.
4. **After every feature (not every file)**, stop and give a short summary of what
   changed and how to test it manually by loading the unpacked extension in
   `chrome://extensions`. Do not chain multiple features together without a checkpoint.
5. **Keep the anonymous device-ID rate limiting as-is** for this phase — do not add
   auth/sign-in yet. That's a later milestone.
6. **Keep OpenRouter as the model provider** — do not switch to a different provider
   without asking.
7. **If you're unsure whether a change is in scope** for the current milestone, ask
   rather than assuming.

### Git Sync

- This repo is **private on GitHub**, used as a safety net / backup — not for external
  collaboration or review.
- After every completed, working task: `git add` + `git commit` locally with a message
  explaining **what changed and why**, then `git push origin dev` immediately so work
  is always backed up.
- **Never push directly to `main`** and **never force-push anything** without asking.
  - `main` = last-known-good checkpoint to roll back to if a session goes sideways.
  - `dev` = working history, all commits land here.
- **Secrets discipline** applies regardless of the repo being private: never commit
  `.env` files, API keys, or Wrangler credentials, full stop.

### Obsidian Sync

- After every completed task, append one entry to:
  `~/Documents/OdysseusVault/04-Projects/ClauseRadar/dev-log.md`
- Create it from the template below if it doesn't exist yet.
- Do **not** create new notes elsewhere in the vault, do **not** edit any existing note
  other than `dev-log.md`, and do **not** rewrite past entries — only append.

### Working Style

- Work **one milestone at a time**, in the order listed in the roadmap below.
- Within a milestone, work **one task at a time**. Commit after each working task with
  a clear commit message explaining **why**, not just what.
- **Flag** anything that looks like a security or data-handling issue, even if it's
  outside the current milestone's scope — don't fix it silently, just flag it.
- If you hit context or rate limits mid-task, stop cleanly at a commit boundary rather
  than leaving half-finished edits.

---

## Project State

| Aspect | Detail |
|--------|--------|
| **Extension** | Chrome MV3 — `manifest.json`, `background.js`, `sidepanel.{html,js,css}` |
| **Backend** | Cloudflare Worker — `worker/index.js`, `wrangler.toml`, `package.json` |
| **Deployment** | Already deployed or deployable via `npx wrangler deploy` |
| **Rate limiting** | Anonymous per-device-id counter in KV, 20/day default |
| **Model** | OpenRouter → `anthropic/claude-haiku-4.5` |
| **Git branches** | `main` (stable checkpoint), `dev` (working branch) |

### Scope for This Phase (Fast MVP — solo use / small beta, few weeks)

**In scope:**
- Classify a clause → Critical / Minor / Administrative
- Compare two clause versions → rated diff table
- Anonymous device-ID rate limiting (KV)
- OpenRouter as model provider
- Local history, Markdown copy, retry/backoff (Milestone 2)
- Polish, keyboard shortcut, real icons, loading states (Milestone 3)

**Explicitly out of scope (deferred — do not build):**
- Google/`chrome.identity` sign-in and per-user quotas
- Document-level batch compare (full doc upload + auto-segmentation)
- Custom/selectable classification frameworks (FDA vs MDR vs GxP)
- Watchlist / `chrome.alarms` polling feature
- Switching off OpenRouter to direct Anthropic API

> These aren't rejected — they're sequenced after real beta feedback tells you which
> one actually matters first.

---

## Scaffold

```
clauseradar/
├── manifest.json          MV3 manifest (side panel + context menu)
├── background.js          Service worker: right-click menu, opens side panel
├── sidepanel/
│   ├── sidepanel.html     The extension UI (classify, compare, settings tabs)
│   ├── sidepanel.js       Tab switching, API proxying, stamp/diff rendering
│   └── sidepanel.css      Design tokens, stamp card, diff table, fonts
├── worker/
│   ├── index.js           Cloudflare Worker: rate limiting, OpenRouter proxy
│   ├── wrangler.toml      Deploy config, KV namespace binding
│   ├── package.json       Wrangler CLI dependency
│   └── package-lock.json  Locked dependency tree
├── icons/
│   ├── icon16.png         Placeholder — swap for real artwork
│   ├── icon48.png         Placeholder — swap for real artwork
│   └── icon128.png        Placeholder — swap for real artwork
├── .gitignore             Ignores node_modules, .env, .wrangler
└── README.md              This file
```

---

## 1. Run the extension locally (no backend yet)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**, select the `clauseradar/` folder
4. Pin the extension, click its icon to open the side panel — the UI works,
   but "Classify" and "Compare" will show an error until the backend is deployed
   and its URL is saved in the Settings tab.

---

## 2. Deploy the backend (Cloudflare Workers, free tier)

You'll need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and an
[OpenRouter API key](https://openrouter.ai/keys).

```bash
cd worker
npm install
npx wrangler login

# create the KV namespace used for daily rate limiting
npx wrangler kv namespace create RATE_LIMIT
# copy the returned id into wrangler.toml (kv_namespaces -> id)

# set your OpenRouter key as a secret (never commit this)
npx wrangler secret put OPENROUTER_API_KEY

npx wrangler deploy
```

Wrangler will print your Worker URL, something like:
`https://clauseradar.<your-subdomain>.workers.dev`

Paste that into the extension's **Settings** tab and hit Save.

---

## 3. Try it

- Highlight a clause on any webpage → right-click → **Classify regulatory impact**
- Or open the side panel and paste text directly into the **Classify** tab
- Use the **Compare** tab to paste an old/new clause pair and get a rated diff table

---

## Cost controls already built in

- `DAILY_LIMIT` in `worker/index.js` caps free usage per anonymous device per day (default 20)
- `MODEL` in the same file defaults to a low-cost OpenRouter model — check
  [openrouter.ai/models](https://openrouter.ai/models) for current pricing and swap if needed
- Cloudflare Workers' free tier covers a generous number of requests/day before any hosting cost kicks in

---

## Roadmap

### Milestone 0 — Foundation (Day 1)
**Goal:** safe to iterate on.

- [ ] git init (if not already), `.gitignore` for `node_modules`, `.env`, `.wrangler`
- [ ] Confirm `OPENROUTER_API_KEY` was only ever set via `wrangler secret put` — never committed
- [ ] Initial commit of current scaffold as-is
- [ ] Write `TESTING.md`: classify happy path, diff happy path, rate-limit-exceeded path, backend unreachable path

**Exit criteria:** clean git history, `TESTING.md` exists, you can run through it once by hand.

---

### Milestone 1 — Close the obvious security gaps (Days 2–4)
**Goal:** safe enough for a small beta, without full auth.

- [ ] Restrict CORS in `index.js` from `*` to the extension's actual origin (`chrome-extension://<id>`)
- [ ] Add basic input validation on the Worker (reject empty/oversized payloads before calling the model, not just `.slice(0, 4000)`)
- [ ] Add a short in-UI data-handling note (footer or Settings tab): what's sent to the backend, that nothing is retained server-side beyond the rate-limit counter
- [ ] Confirm KV rate limiting behaves as expected under quick repeated requests

**Exit criteria:** CORS restricted, data-handling note visible in the extension, `TESTING.md` re-run passes.

---

### Milestone 2 — Core workflow features for daily use (Days 5–10)
**Goal:** the extension is actually useful to use daily, not just demo-able.

- [ ] Local history: every classify/diff result saved to `chrome.storage.local` (or IndexedDB if it grows) with timestamp, source URL, and result — visible in a new "History" tab
- [ ] "Copy as Markdown" button on both the classify stamp and the diff table
- [ ] Autosave draft text in Classify/Compare textareas so a closed panel doesn't lose in-progress work
- [ ] Basic retry/backoff on the Worker's OpenRouter call (one retry on transient failure before surfacing an error)
- [ ] JSON schema validation of the model's response before sending to the frontend (catch missing level, invalid enum values, retry once with a stricter prompt on failure)

**Exit criteria:** you can classify/compare, see it in history, copy it out, and a Worker hiccup doesn't just dump a raw error on the user.

---

### Milestone 3 — Polish for a small beta (Days 11–15)
**Goal:** ready to hand to a few real regulatory professionals.

- [ ] Keyboard shortcut (`manifest.json` commands) to open panel + run classify on current selection
- [ ] Replace placeholder icons with real 16/48/128px artwork
- [ ] Loading states / disabled-button states reviewed for every async action (some already exist — audit for gaps)
- [ ] Short privacy write-up finalized (for both in-UI note and future store listing)
- [ ] Decide and document: which regulatory framework definitions (Critical/Minor/Administrative) ship as default — confirm the current MDR-flavored prompt wording is what you want for beta, or adjust

**Exit criteria:** you'd be comfortable handing this to 2–3 real users without walking them through known rough edges first.

---

### Milestone 4 — Small beta & feedback loop (Days 16–21+)
**Goal:** validate with real usage before investing further.

- [ ] Load unpacked, share with a small group (or self-use daily for a week)
- [ ] Track: does the 20/day limit feel right? Any classification results that felt wrong or unclear? Any UI friction?
- [ ] Decide next phase based on real feedback: is auth/history-at-scale needed sooner than planned, or does batch document compare matter more than expected?


### Milestone 5 — Change-control audit trail for regulatory use (Days 22–27)
**Goal:** every classification and comparison produces a tamper-evident audit record suitable for GxP/regulatory inspection.

- [ ] Structured audit log: each classify/compare result persisted as a JSON record with timestamp, source URL, input hash, raw model response, and final classification — stored in `chrome.storage.local` (separate from the History view)
- [ ] Immutable append: audit records are write-once (never edited after creation) to maintain a defensible chain of custody; provide a "reason for review" field if a user wants to flag a record for later reconsideration
- [ ] Audit log viewer: dedicated read-only "Audit" tab in the side panel that displays records sorted by timestamp with a search/filter bar and a "Copy record as JSON" button per entry
- [ ] Bulk export: "Export audit trail" button in the Audit tab that serialises all records to a single JSON file (downloads as `clauseradar-audit-YYYY-MM-DD.json`)
- [ ] Timestamp integrity: use `chrome.storage.local` write timestamps combined with the request timestamp to establish a time-of-decision record; optionally SHA-256 chain recent records (each record references the previous record's hash) to detect tampering
- [ ] In-UI audit note: a sentence in both the Classify and Compare result panels reading *"This result is logged to the audit trail (view in the Audit tab)."*

**Exit criteria:** an auditor could open the Audit tab, browse every classification made to-date, export the full trail as JSON, and verify that records have not been retroactively altered.

---

## Before publishing to the Chrome Web Store

- Replace the placeholder icons in `icons/` with real artwork (16/48/128 px)
- Write a short privacy note: the extension sends selected/pasted text to your backend
  for classification — say so plainly in the store listing
- Decide on a paid tier if you want the backend cost to be self-sustaining once there's traffic
- $5 one-time Chrome Web Store developer registration fee

---

## Dev Log Template

Create `~/Documents/OdysseusVault/04-Projects/ClauseRadar/dev-log.md` with this structure.
After every completed task, append one entry:

```markdown
# ClauseRadar Dev Log

## YYYY-MM-DD — Milestone X, Task: <short name>
- **What changed:** <one line>
- **Why:** <one line>
- **Files touched:** <list>
- **Commit:** <short hash>
- **Tested:** <how, or N/A for setup>
- **Follow-ups / open questions:** <or "none">
```

Rules for entries:
- Each new entry goes at the **bottom**.
- One task = one entry.
- Keep entries short — this is a log to scan quickly across sessions and tools
  (Odysseus one day, Kimi Code the next), not a full changelog.
- If you find yourself writing more than ~5 lines per entry, it's probably two tasks.
- **Do not** create new notes elsewhere in the vault, do **not** edit any existing note
  other than `dev-log.md`, and do **not** rewrite past entries — only append.

---

## Deferred (explicitly out of scope for this MVP phase)

- Google/`chrome.identity` sign-in and per-user quotas
- Document-level batch compare (full doc upload + auto-segmentation)
- Custom/selectable classification frameworks (FDA vs MDR vs GxP)
- Watchlist / `chrome.alarms` polling feature
- Switching off OpenRouter to direct Anthropic API
