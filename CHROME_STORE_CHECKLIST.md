# ClauseRadar — Chrome Web Store Publishing Checklist

## Pre-Publication Requirements

### 1. Developer Account & Fees
- [ ] Register as Chrome Web Store Developer ($5 one-time fee)
- [ ] Verify identity (required for publishing)

### 2. Extension Package
- [ ] **Manifest V3** ✓ (already using MV3)
- [ ] **Single purpose** clearly described ✓ (regulatory clause classification)
- [ ] **All permissions justified** ✓
  - `contextMenus` — right-click "Classify regulatory impact"
  - `sidePanel` — main UI
  - `storage` — device ID, drafts, history, preferences
  - `activeTab` — get selected text on current page
  - `scripting` — inject content script to read selection
  - `host_permissions: https://clauseradar.ahali-clauseradar.workers.dev/*` — API endpoint

### 3. Privacy & Legal
- [x] **Privacy Policy** created at `PRIVACY_POLICY.md`
- [ ] **Privacy Policy URL** — Host publicly (GitHub Pages, your domain, or store listing)
- [ ] **Data handling disclosure** in store listing ✓ (covered in privacy policy)

### 4. Store Assets (Required)
| Asset | Specs | Status |
|-------|-------|--------|
| **Small icon** | 128×128 PNG | ✓ `icons/icon128.png` |
| **Large icon** | 128×128 PNG (same) | ✓ |
| **Screenshots** | 1280×800 or 640×400 (min 1, max 5) | ❌ **NEED TO CREATE** |
| **Promotional tile** | 440×280 PNG | ❌ **NEED TO CREATE** |
| **Marquee (optional)** | 1400×560 PNG | ❌ **OPTIONAL** |

### 5. Store Listing Content
- [x] **Name:** ClauseRadar
- [x] **Short description** (≤132 chars): "Classify regulatory clause impact (Critical/Minor/Administrative) and compare document versions."
- [ ] **Detailed description** — Write compelling, user-focused copy
- [ ] **Category:** Developer Tools / Productivity
- [ ] **Language:** English (add more if localized)
- [ ] **Support email:** Must be valid and monitored
- [ ] **Website:** https://github.com/Limpohal/ClauseRadar (or your domain)

### 6. Testing (Must Pass)
- [ ] Load unpacked in Chrome → no console errors
- [ ] Classify tab works (single & multi-framework)
- [ ] Compare tab works (Clause & Document modes)
- [ ] History persists across reloads
- [ ] Rate limit shows correctly (20/day)
- [ ] Error handling: offline, rate limit, bad input
- [ ] Keyboard shortcut works (Ctrl/Cmd+Shift+C)
- [ ] Context menu appears on text selection
- [ ] File upload (.txt, .md, .docx, .pdf) works in Document mode
- [ ] Export (Copy MD / Download .md) works

### 7. Content Security Policy
- [x] `script-src 'self'` — no inline scripts, no external scripts
- [x] `object-src 'self'` — no plugins
- [x] `font-src 'self'` — local fonts only
- [ ] **No `'unsafe-eval'` or `'unsafe-inline'`** ✓ (extension doesn't use them)

### 8. Backend Readiness
- [x] Worker deployed at `https://clauseradar.ahali-clauseradar.workers.dev`
- [x] KV namespace bound for rate limiting
- [x] `OPENROUTER_API_KEY` secret set
- [x] CORS accepts any `chrome-extension://` origin
- [x] Rate limit: 20/day per device
- [ ] **Monitor costs** — OpenRouter usage (set billing alerts)
- [ ] **Consider custom domain** for professional appearance

### 9. Versioning & Updates
- [ ] Version in manifest: `1.0.0`
- [ ] Update mechanism: Chrome handles auto-updates
- [ ] Changelog maintained (README.md or CHANGELOG.md)

---

## Quick Asset Generation Tips

### Screenshots (1280×800)
Take screenshots of:
1. **Classify tab** — with a sample result stamp
2. **Compare tab (Clause)** — with diff table
3. **Compare tab (Document)** — with expandable sections
4. **History tab** — with a few entries
5. **Settings tab** — showing quota

### Promotional Tile (440×280)
- Logo + "ClauseRadar" + tagline: "AI-Powered Regulatory Clause Analysis"
- Clean, on-brand colors (use your CSS variables: `--critical`, `--admin`, `--paper`)

---

## Post-Publication

- [ ] Submit for review (typically < 24 hours)
- [ ] Monitor reviews & respond promptly
- [ ] Set up error monitoring (Sentry, etc.) if desired
- [ ] Plan v1.1: user feedback, bug fixes, improvements

---

## Estimated Timeline

| Task | Time |
|------|------|
| Create screenshots & promo tile | 1-2 hours |
| Write store description | 30 min |
| Host privacy policy publicly | 15 min |
| Developer registration + $5 | 15 min |
| Submit & wait for review | 1-3 days |
| **Total** | **~1 day active work + review time** |

---

## Cost Summary

| Item | Cost |
|------|------|
| Chrome Developer Registration | $5 (one-time) |
| Cloudflare Workers | Free tier (100K requests/day) |
| OpenRouter API | Pay-per-use (~$0.0001/request) |
| **Monthly (100 users × 20/day)** | ~$60/month in API costs |
| **Recommended: Set billing alert at $20/mo** | |

---

## Ready to Submit?

Run this final check:
```bash
# 1. Validate manifest
cat manifest.json | node -e "JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Valid JSON')"

# 2. Check all JS syntax
node --check background.js && node --check sidepanel/sidepanel.js && node --check worker/index.js

# 3. Verify icons exist
ls icons/icon16.png icons/icon48.png icons/icon128.png

# 4. Verify locale
cat _locales/en/messages.json | node -e "JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Valid i18n')"
```

If all pass → you're ready to package and submit!