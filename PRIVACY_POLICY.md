# ClauseRadar — Privacy Policy

**Effective Date:** August 28, 2026  
**Version:** 1.2  
**Extension Name:** ClauseRadar  
**Developer:** Halim Ashraf  
**Contact:** Limpohal@users.noreply.github.com

---

## 1. Overview

ClauseRadar ("we", "us", "our") is a Chrome browser extension designed for regulatory affairs professionals to classify the significance of regulatory clauses and compare document versions. This Privacy Policy explains what information we collect, how we use it, and your rights regarding your data.

We are committed to protecting your privacy. We collect only the minimum data necessary to provide the service, and we do not sell your data to third parties.

---

## 2. Information We Collect

### 2.1 Data You Provide Voluntarily
- **Clause text you paste or select** — Text you paste into the extension or highlight on web pages for classification/comparison
- **Framework selections** — Your chosen regulatory frameworks (EU MDR, FDA, ISO, etc.)

### 2.2 Automatically Generated Data
- **Anonymous Device ID** — A randomly generated UUID (e.g., `550e8400-e29b-41d4-a716-446655440000`) created on first install and stored locally in `chrome.storage.local`. This is used **only** for rate limiting (20 requests/day per device, plus a global daily service-capacity limit shared across all users to control infrastructure costs).
- **Usage Timestamps** — When you make a classification or comparison request (for rate limit window calculation).
- **Global Service-Capacity Counter** — A daily, date-keyed counter of total AI model calls across all users (a number only — no device ID, no clause text). Enforces the service-wide capacity limit that protects against abuse and keeps the service free.

### 2.3 Data We Do NOT Collect
- ❌ No personally identifiable information (name, email, IP address, location)
- ❌ No browsing history or web activity
- ❌ No authentication credentials or account data
- ❌ No clipboard contents beyond what you explicitly paste into the extension
- ❌ No analytics, tracking, or advertising identifiers

---

## 3. How We Use Your Data

| Data Type | Purpose | Legal Basis |
|-----------|---------|-------------|
| Clause text | Send to backend for AI classification/comparison via OpenRouter | Legitimate interest (providing requested service) |
| Framework selection | Tailor AI prompts to selected regulatory context | Legitimate interest |
| Device ID | Enforce daily rate limit (20 requests/day) | Legitimate interest (abuse prevention) |
| Global capacity counter (anonymous number) | Enforce the daily service-wide AI-call budget | Legitimate interest (abuse prevention, cost control) |
| Timestamps | Calculate 24-hour rate limit windows | Legitimate interest |

**We do not use your data for:** advertising, profiling, marketing, selling to third parties, or any purpose beyond providing the classification/comparison service.

---

## 4. Data Sharing & Third Parties

### 4.1 Our Backend (Cloudflare Workers)
- **Provider:** Cloudflare, Inc.
- **Data sent:** Clause text, framework selection, anonymous device ID
- **Purpose:** Process classification/comparison requests, enforce rate limits
- **Retention:** Request counters expire after 2 days. Clause text is **not stored** server-side beyond the request lifecycle.

### 4.2 AI Model Provider (OpenRouter)
- **Provider:** OpenRouter (openrouter.ai)
- **Data sent:** Clause text + framework-specific prompt (no device ID, no user identity)
- **Purpose:** Generate classification/comparison results
- **Policy:** See [OpenRouter Privacy Policy](https://openrouter.ai/privacy)
- **Note:** We use the `openai/gpt-5.6-luna` model. OpenRouter acts as a gateway; we do not control their sub-processors.

### 4.3 No Other Sharing
We do not share data with any other third parties, advertisers, data brokers, or analytics providers.

---

## 5. Data Storage & Retention

| Storage Location | Data | Retention |
|------------------|------|-----------|
| **Local (`chrome.storage.local`)** | Device ID, draft text, history (last 50 items), framework preferences | Until you uninstall the extension or clear browser data |
| **Backend (Cloudflare KV)** | Daily request counter per device ID | 2 days (auto-expires) |
| **Backend (Memory)** | Clause text during request processing | Milliseconds (request lifecycle only) |
| **OpenRouter** | Per their policy | Per [OpenRouter Privacy Policy](https://openrouter.ai/privacy) |

**You can clear all local data anytime:** Chrome → Extensions → ClauseRadar → Details → "Clear storage" or use the "Clear history" button in the extension's History tab.

---

## 6. Your Rights

Under applicable privacy laws (GDPR, CCPA, etc.), you have the right to:

- **Access** — Know what data we hold (this policy + local storage inspection)
- **Delete** — Uninstall the extension or use "Clear history" to remove all local data
- **Portability** — Export your history as Markdown via the "Copy as Markdown" / "Download .md" buttons
- **Object/Restrict** — Disable the extension to stop all processing
- **Human oversight of AI output** — The AI suggests classifications (Critical/Minor/Administrative), but you retain full control to accept, override, or export results

To exercise these rights, simply use the extension's built-in controls or uninstall it. No account or request process is needed.

---

## 7. Children's Privacy

ClauseRadar is not directed to children under 13 (or 16 in the EU). We do not knowingly collect data from children. If you believe a child has provided data, contact us and we will delete it.

---

## 8. Security

- All network communication uses HTTPS (TLS 1.2+)
- No credentials or API keys stored in the extension (OpenRouter key is server-side only)
- Device ID is a random UUID, not derived from hardware or personal info
- Content Security Policy restricts extension scripts to `self` only

---

## 9. International Transfers

Your clause text is sent to:
- Cloudflare Workers (global edge network — data may process in any Cloudflare data center)
- OpenRouter (US-based, may use global model providers)

By using the extension, you consent to this transfer. Both providers maintain appropriate safeguards.

---

## 10. Changes to This Policy

We may update this policy occasionally. Material changes will be noted in the extension's changelog or via a notification. Continued use after changes constitutes acceptance.

---

## 11. Chrome Web Store Compliance

This extension complies with the [Chrome Web Store Developer Program Policies](https://developer.chrome.com/docs/webstore/program-policies/):
- **Single Purpose:** Clear, narrow functionality (regulatory clause classification/comparison)
- **Minimal Permissions:** Only `contextMenus`, `sidePanel`, `storage`, `activeTab`, `scripting`
- **Narrow Host Permissions:** Only `https://clauseradar.ahali-clauseradar.workers.dev/*`
- **No Deceptive Practices:** No hidden behavior, no data selling, no misleading UI
- **Privacy Policy:** This document, accessible via store listing

---

## 12. Contact

For questions, concerns, or data requests:

**Email:** Limpohal@users.noreply.github.com  
**GitHub:** https://github.com/Limpohal/ClauseRadar

---

## 13. Summary for Users

| What Happens to Your Clause Text? |
|-----------------------------------|
| 1. You paste/select text in the extension |
| 2. Text + framework choice sent to our Cloudflare Worker (HTTPS) |
| 3. Worker checks daily limit (anonymous device ID) |
| 4. Worker forwards text + prompt to OpenRouter (HTTPS) |
| 5. AI returns classification/comparison |
| 6. Result shown to you; **text discarded from server** |
| 7. Only a counter (device ID + date) stays in KV for 2 days |

**You own your data. We process it only to give you the result you asked for.**