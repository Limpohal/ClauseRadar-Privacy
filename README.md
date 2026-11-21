# ClauseRadar

**AI-powered regulatory clause classification and document comparison for medical device professionals.**

---

## Overview

ClauseRadar is a Chrome MV3 extension that helps regulatory affairs professionals instantly classify the significance of regulatory clauses and compare document versions with AI-powered analysis.

### Key Features

| Feature | Description |
|---------|-------------|
| **Classify** | Paste or select any clause → get instant impact classification (Critical / Minor / Administrative) with cited rationale |
| **Compare** | Side-by-side clause or full-document diff with significance ratings per change |
| **Frameworks** | EU MDR, FDA 21 CFR Part 820, ISO 13485, EN standards, ASTM, PPER, General |
| **Human oversight** | AI suggests, you decide — accept, override, or export results |
| **Local history** | All results saved locally, exportable as Markdown |
| **Privacy-first** | No accounts, no tracking, anonymous rate limiting (20 requests/day) |

---

## How It Works

1. **Select or paste** a regulatory clause on any webpage
2. **Choose framework(s)** — EU MDR, FDA, ISO 13485, etc.
3. **Click Classify** → AI analyzes against selected framework
4. **Review result** — Level, rationale, citation, confidence, borderline flag
5. **Override if needed** — Record your reasoning, export as Markdown

For document comparison:
- Upload or paste two document versions (.txt, .md, .docx, .pdf)
- Auto-segmented into clauses, compared section-by-section
- Expandable sections with search/filter/export

---

## Privacy & Security

- **No accounts required** — anonymous device ID for rate limiting only
- **No data stored server-side** — clause text processed in memory only
- **Local-first** — all history stored in `chrome.storage.local`
- **Transparent** — [Full Privacy Policy](privacy-policy.html)

---

## Installation

### Chrome Web Store (Recommended)
[Install from Chrome Web Store](https://chrome.google.com/webstore/detail/clauseradar) *(pending publication)*

### Manual (Developer Mode)
1. Download the latest release
2. Open `chrome://extensions` → Enable **Developer mode**
3. Click **Load unpacked** → Select the `clauseradar` folder

---

## Architecture

| Component | Technology |
|-----------|------------|
| **Extension** | Chrome MV3 (Manifest V3), Side Panel API, Service Worker |
| **Backend** | Cloudflare Workers (TypeScript) |
| **AI Model** | OpenRouter → `anthropic/claude-haiku-5.5` |
| **Rate Limiting** | Cloudflare KV (anonymous, per-device, 20/day) |
| **PDF/DOCX** | pdf.js + mammoth.js (client-side) |

---

## Links

- **Privacy Policy:** [https://Limpohal.github.io/ClauseRadar-Privacy/privacy-policy.html](privacy-policy.html)
- **Source Code:** [GitHub Repository](https://github.com/Limpohal/ClauseRadar)
- **Backend API:** `https://clauseradar.ahali-clauseradar.workers.dev/v1/analyze`

---

## License

Proprietary — All rights reserved.

---

*Built for medical device regulatory professionals who need fast, reliable, and auditable clause analysis.*