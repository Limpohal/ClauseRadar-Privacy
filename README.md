# ClauseRadar

An AI-assisted Chrome extension for regulatory affairs professionals: classify the
significance of a clause (Critical / Minor / Administrative) and compare two
versions of a document, without leaving the browser.

## What's in this scaffold

```
clauseradar/
  manifest.json         MV3 manifest (side panel + context menu)
  background.js         Service worker: right-click menu, opens side panel
  sidepanel/             The extension UI (classify, compare, settings tabs)
  worker/                Cloudflare Worker backend that calls OpenRouter
  icons/                 Placeholder icons — swap these for real artwork
```

## 1. Run the extension locally (no backend yet)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**, select the `clauseradar/` folder
4. Pin the extension, click its icon to open the side panel — the UI works,
   but "Classify" and "Compare" will show an error until the backend is deployed
   and its URL is saved in the Settings tab.

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

## 3. Try it

- Highlight a clause on any webpage → right-click → **Classify regulatory impact**
- Or open the side panel and paste text directly into the **Classify** tab
- Use the **Compare** tab to paste an old/new clause pair and get a rated diff table

## Cost controls already built in

- `DAILY_LIMIT` in `worker/index.js` caps free usage per anonymous device per day (default 20)
- `MODEL` in the same file defaults to a low-cost OpenRouter model — check
  [openrouter.ai/models](https://openrouter.ai/models) for current pricing and swap if needed
- Cloudflare Workers' free tier covers a generous number of requests/day before any hosting cost kicks in

## Before publishing to the Chrome Web Store

- Replace the placeholder icons in `icons/` with real artwork (16/48/128 px)
- Write a short privacy note: the extension sends selected/pasted text to your backend
  for classification — say so plainly in the store listing
- Decide on a paid tier if you want the backend cost to be self-sustaining once there's traffic
- $5 one-time Chrome Web Store developer registration fee

## Suggested next steps

- Swap the anonymous device-id rate limiting for Google sign-in (`chrome.identity`) if you
  want to tie usage to an account for a future paid tier
- Add a "copy as Markdown" button to the diff table for pasting into Word reports
- Consider a lightweight watchlist feature (Phase 3) that polls a bookmarked URL and
  flags text changes using `chrome.alarms`
