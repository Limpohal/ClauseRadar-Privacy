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
8. **GIT SYNC: this repo is private on GitHub**, used as a safety net / backup — not
   for external collaboration or review. After every completed, working task: `git add`
   + `git commit` locally with a message explaining **what changed and why**, then
   `git push origin dev` immediately so work is always backed up. **Never push directly
   to `main`** and **never force-push anything** without asking. `main` stays as your
   last-known-good checkpoint to roll back to if a session goes sideways, `dev` is the
   working history. **Secrets discipline** applies regardless of the repo being private:
   never commit `.env` files, API keys, or Wrangler credentials, full stop.
9. **OBSIDIAN SYNC: after every completed task**, append one entry to
   `~/Documents/OdysseusVault/04-Projects/ClauseRadar/dev-log.md` (create it from the
   template in Part 3 below if it doesn't exist yet). Do **not** create new notes
   elsewhere in the vault, do **not** edit any existing note other than `dev-log.md`,
   and do **not** rewrite past entries — only append.

### Working Style

---

## Project State

| Aspect | Detail |
|--------|--------|
| **Extension** | Chrome MV3 — `manifest.json`, `background.js`, `sidepanel.{html,js,css}` |
| **Backend** | Cloudflare Worker — `worker/index.js`, `wrangler.toml`, `package.json` |
| **Deployment** | Already deployed or deployable via `npx wrangler deploy` |
| **Rate limiting** | Anonymous per-device-id counter in KV, 20/day default |
| **Model** | OpenRouter → `deepseek/deepseek-v4-flash` |
| **Git branches** | `main` (stable checkpoint), `dev` (working branch) |

### Scope for This Phase (Milestones 0–5 — ALL COMPLETE)

**Built and shipped (M0–M5):**
- Classify a clause → Critical / Minor / Administrative
- Compare two clause versions → rated diff table
- Document-level compare: full document paste or `.docx`/PDF upload, auto-segmentation, scrollable report with search/filter/stats/export
- Context tagging: multi-select jurisdiction/framework checkboxes (EU MDR, FDA 21 CFR, ISO 13485, IVDR, etc.)
- Cited rationale, confidence / borderline flag, user override + reasoning, export upgrade
- Anonymous device-ID rate limiting (KV, 20/day)
- OpenRouter as model provider
- Local history, Markdown copy, retry/backoff (Milestone 2)
- Polish, keyboard shortcut, real icons, loading states (Milestone 3)

**Still deferred (post-M5 — scoped by real user feedback):**
- Google/`chrome.identity` sign-in and per-user quotas
- Shared/team workspace for classifications (beyond local history)
- Watchlist / `chrome.alarms` polling for regulatory page changes
- Switching off OpenRouter to direct Anthropic API
- Selective stronger-model routing (e.g. Haiku for single clauses, a stronger model for full document compare)

> These aren't rejected — they're sequenced after Milestone 5 user feedback
> tells you which one actually matters most next.

---

## Scaffold

```
clauseradar/
├── manifest.json          MV3 manifest (side panel + context menu + keyboard shortcut)
├── background.js          Service worker: right-click menu, keyboard shortcut, API proxy
├── TESTING.md             Manual test checklist (4 paths)
├── sidepanel/
│   ├── sidepanel.html     Extension UI (Classify, Compare, History, Settings tabs)
│   ├── sidepanel.js       Tab switching, API proxy, stamp/diff/report rendering
│   ├── sidepanel.css      Design tokens, stamp card, diff table, doc report, themes
│   └── lib/
│       ├── mammoth.browser.min.js   Client-side .docx reader
│       ├── pdf.min.js              pdf.js entry point
│       ├── pdf.min.mjs             pdf.js ES module
│       ├── pdf.worker.min.js       pdf.js worker entry
│       └── pdf.worker.min.mjs      pdf.js worker ES module
├── worker/
│   ├── index.js           Cloudflare Worker: rate limiting, OpenRouter proxy
│   ├── wrangler.toml      Deploy config, KV namespace binding
│   ├── package.json       Wrangler CLI dependency
│   └── package-lock.json  Locked dependency tree
├── icons/
│   ├── icon16.png         Real § + radar design
│   ├── icon48.png         Real § + radar design
│   └── icon128.png        Real § + radar design
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

## Git & Obsidian Sync Setup (do this once, before Milestone 0)

### Git branch setup

```bash
git checkout -b dev
git push -u origin dev
```

This repo is private, used purely as a safety net for solo work — not for external
review. Work happens on `dev`, and the agent pushes there after every task so nothing
is ever more than one task away from being backed up. `main` only moves when you
deliberately merge into it, so it always represents a known-good state you can roll
back to if a session leaves the working branch broken.

### Obsidian dev-log template

Create `~/Documents/OdysseusVault/04-Projects/ClauseRadar/dev-log.md` with this
starting structure, and have the agent append one entry per completed task in this
exact format:

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

Each new entry goes at the **bottom**, one task = one entry. Keep entries short — this
is a log to scan quickly across sessions and tools (Odysseus one day, Kimi Code the
next), not a full changelog. If you (the agent) find yourself writing more than ~5
lines per entry, it's probably two tasks, not one.

---

## Roadmap

### Milestone 0 — Foundation (Day 1)
**Goal:** safe to iterate on.

- [x] git init (if not already), `.gitignore` for `node_modules`, `.env`, `.wrangler`
- [x] Confirm `OPENROUTER_API_KEY` was only ever set via `wrangler secret put` — never committed
- [x] Initial commit of current scaffold as-is
- [x] Write `TESTING.md`: classify happy path, diff happy path, rate-limit-exceeded path, backend unreachable path

**Exit criteria:** clean git history, `TESTING.md` exists, you can run through it once by hand.

---

### Milestone 1 — Close the obvious security gaps (Days 2–4)
**Goal:** safe enough for a small beta, without full auth.

- [x] Restrict CORS in `index.js` from `*` to the extension's actual origin (`chrome-extension://<id>`)
- [x] Add basic input validation on the Worker (reject empty/oversized payloads before calling the model, not just `.slice(0, 4000)`)
- [x] Add a short in-UI data-handling note (footer or Settings tab): what's sent to the backend, that nothing is retained server-side beyond the rate-limit counter
- [x] Confirm KV rate limiting behaves as expected under quick repeated requests

**Exit criteria:** CORS restricted, data-handling note visible in the extension, `TESTING.md` re-run passes.

---

### Milestone 2 — Core workflow features for daily use (Days 5–10)
**Goal:** the extension is actually useful to use daily, not just demo-able.

- [x] Local history: every classify/diff result saved to `chrome.storage.local` (or IndexedDB if it grows) with timestamp, source URL, and result — visible in a new "History" tab
- [x] "Copy as Markdown" button on both the classify stamp and the diff table
- [x] Autosave draft text in Classify/Compare textareas so a closed panel doesn't lose in-progress work
- [x] Basic retry/backoff on the Worker's OpenRouter call (one retry on transient failure before surfacing an error)
- [x] JSON schema validation of the model's response before sending to the frontend (catch missing level, invalid enum values, retry once with a stricter prompt on failure)

**Exit criteria:** you can classify/compare, see it in history, copy it out, and a Worker hiccup doesn't just dump a raw error on the user.

---

### Milestone 3 — Polish for a small beta (Days 11–15)
**Goal:** ready to hand to a few real regulatory professionals.

- [x] Keyboard shortcut (`manifest.json` commands) to open panel + run classify on current selection
- [x] Replace placeholder icons with real 16/48/128px artwork
- [x] Loading states / disabled-button states reviewed for every async action (some already exist — audit for gaps)
- [x] Short privacy write-up finalized (for both in-UI note and future store listing)
- [x] Decide and document: which regulatory framework definitions (Critical/Minor/Administrative) ship as default — confirm the current MDR-flavored prompt wording is what you want for beta, or adjust

**Exit criteria:** you'd be comfortable handing this to 2–3 real users without walking them through known rough edges first.

---

### Milestone 4 — Small beta & feedback loop (Days 16–21+)
**Goal:** validate with real usage before investing further.

- [x] Load unpacked, share with a small group (or self-use daily for a week)
- [x] Track: does the 20/day limit feel right? Any classification results that felt wrong or unclear? Any UI friction?
- [x] Decide next phase based on real feedback: is auth/history-at-scale needed sooner than planned, or does batch document compare matter more than expected?


### Milestone 5 — Professional-grade credibility (post-beta, scope by feedback)
**Goal:** move from "useful utility" to "something a compliance professional defends a real decision with." Pull items from here based on what Milestone 4 feedback actually surfaces — don't build all of it blind, and don't start this milestone until Milestone 4's exit criteria is met.

- [x] **Document-level compare:** accept full document paste or `.docx`/PDF upload for both sides, auto-segment into clauses, run the diff across the whole document, output as a scrollable report with search, filter, and Markdown export — **done in M5**
- [x] **Context tagging:** let the user set jurisdiction/framework (EU MDR, FDA 21 CFR, ISO 13485, IVDR, etc.) before classifying, and pass that into the prompt instead of the current generic rubric
- [x] **Cited rationale:** prompt the model to point to the specific phrase or concept that triggered the classification, not just a generic one-sentence rationale
- [x] **Confidence / borderline flag:** surface when a clause is genuinely ambiguous ("could argue Minor or Critical") instead of forcing false certainty into one label
- [x] **User override + reasoning:** let the user change the AI's classification and record why — store the override alongside the original call so it becomes part of the exportable record
- [x] **Export upgrade:** extend the existing Markdown export to include citation, confidence flag, and any override/reasoning per row

**Exit criteria:** a classification or diff result, once exported, reads like something that could support a real change-control or audit record — not just a labeled snippet.

---

## Before publishing to the Chrome Web Store

- ~~Replace the placeholder icons~~ — ✅ done in Milestone 3 (custom § + radar design)
- Write a short privacy note: the extension sends selected/pasted text to your backend
  for classification — say so plainly in the store listing
- Decide on a paid tier if you want the backend cost to be self-sustaining once there's traffic
- $5 one-time Chrome Web Store developer registration fee

---

## Deferred (post-Milestone 5 — all M5 items shipped, these remain)

- Google/`chrome.identity` sign-in and per-user quotas
- Shared/team workspace for classifications (beyond local history)
- Watchlist / `chrome.alarms` polling for regulatory page changes
- Switching off OpenRouter to direct Anthropic API
- Selective stronger-model routing (e.g. Haiku for single clauses, a stronger model for full document compare)

These aren't rejected — M5 complete. Next priorities decided by real user feedback.
