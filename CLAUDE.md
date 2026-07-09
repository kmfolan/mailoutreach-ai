# CLAUDE.md — MailOutreach AI Codebase Guide

## Project Overview

MailOutreach AI is an AI-powered cold outreach platform that extends the original MailOutreach with:

1. **AI prospect research** — GPT-4o mini analyzes the prospect website and builds a profile before email writing.
2. **SEO audit (Agent 1.5)** — DataForSEO pulls real keyword rankings and organic traffic per prospect. Generates a unique public audit report page (`/audit/:id`) used as the free audit hook in outreach emails.
3. **AI email writing** — Claude Sonnet writes personalized 3-email sequences. Email 1 teases the audit with real SEO numbers; Email 2 includes the audit URL as the CTA.
4. **Contact enrichment** — Google Maps Places API (primary) + Bing RSS (fallback) for discovery; Snov.io for email enrichment.
5. **Email sending** — nodemailer SMTP stub wired to Microsoft 365 (or any provider).
6. **Open/click/audit tracking** — pixel + redirect + audit page view endpoints with in-memory event storage.
7. **Reply classification (Agent 3A)** — GPT-4o mini classifies inbound replies into 7 categories.
8. **Reply drafting (Agent 3B)** — Claude Sonnet drafts appropriate reply based on classification.
9. **Weekly optimizer (Agent 4)** — GPT-4o analyzes campaign-level data and produces a priority action plan.

Both manual and autonomous workflows are supported, same as the original.

---

## Repository Layout

```
/
├── index.html              # SPA shell — updated for AI branding + send modal
├── app.js                  # Frontend JS — adds send flow + AI-specific renders
├── styles.css              # Original styles + modal + AI tag CSS additions
├── service-worker.js       # PWA offline cache
├── manifest.webmanifest    # PWA manifest
├── .env.example            # All env vars including new API keys
├── run-server.sh           # Linux/macOS launch script
├── server/
│   ├── package.json        # name: mailoutreach-ai-server
│   └── src/
│       ├── index.js        # HTTP server — all original routes + send + tracking
│       ├── store.js        # Business logic — AI agents wired in here
│       ├── discovery.js    # Google Maps + Bing RSS discovery + Snov.io enrichment
│       ├── sender.js       # SMTP stub + sequence scheduler + tracking helpers
│       └── agents/
│           ├── research.js     # Agent 1: GPT-4o mini prospect profiler
│           ├── emailWriter.js  # Agent 2: Claude Sonnet email writer (prompt cached)
│           ├── classifier.js   # Agent 3A: GPT-4o mini reply classifier
│           ├── replyDrafter.js # Agent 3B: Claude Sonnet reply drafter (prompt cached)
│           └── optimizer.js    # Agent 4: GPT-4o weekly campaign optimizer
├── deploy/
│   ├── bootstrap-ubuntu.sh
│   ├── nginx-mailoutreach-ai.conf
│   ├── mailoutreach-ai.service
│   ├── deploy-example.sh
│   └── rsync-exclude.txt
└── server/data/db.json     # JSON persistence (gitignored)
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 (ESM modules) |
| HTTP server | Node built-in `http` (no Express) |
| Frontend | Vanilla HTML, CSS, plain JS |
| Data persistence | `server/data/db.json` (synchronous `fs.writeFileSync`) |
| Authentication | In-memory sessions + HMAC-signed cookies |
| Prospect discovery | Google Maps Places Text Search API → Bing RSS fallback |
| Contact enrichment | Snov.io domain emails API → pattern guessing fallback |
| AI model routing | GPT-4o mini (research, classification, optimization), Claude Sonnet (writing) |
| Email sending | nodemailer STUB (wire up after install) |
| Tracking | In-memory `Map` (resets on restart) |
| Deployment target | DigitalOcean droplet behind Nginx + systemd |

No npm dependencies beyond Node built-ins. No TypeScript. No build pipeline.

---

## Running the Server

```bash
cp .env.example .env
# Fill in OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_MAPS_API_KEY, etc.

./run-server.sh
# or: node server/src/index.js
```

Server listens on `http://localhost:4021` by default (port 4021 to avoid conflict with the original on 4020).

### Environment Variables

| Variable | Purpose | Required |
|---|---|---|
| `PORT` | HTTP port (default: `4021`) | No |
| `AUTH_USERNAME` | Login username (default: `admin`) | No |
| `AUTH_PASSWORD` | Login password | Yes for production |
| `AUTH_SESSION_SECRET` | HMAC key for session tokens | Yes for production |
| `OPENAI_API_KEY` | For research, classification, optimizer agents | Yes for AI features |
| `ANTHROPIC_API_KEY` | For email writer and reply drafter agents | Yes for AI features |
| `GOOGLE_MAPS_API_KEY` | Places Text Search API for discovery | Yes for autonomous runs |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | DataForSEO API for SEO audit (Agent 1.5) | No (falls back gracefully) |
| `SNOV_CLIENT_ID` / `SNOV_CLIENT_SECRET` | Snov.io contact enrichment | No (falls back to patterns) |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | SMTP sending credentials | Yes for email sending |
| `SMTP_PORT`, `SMTP_SECURE` | SMTP port and TLS flag | No |
| `SMTP_FROM_NAME` | Sender display name | No |
| `TRACKING_HOST` | Public hostname for tracking pixel/redirect URLs | Yes for tracking |
| `NODE_ENV` | Set to `production` behind HTTPS | No |
| `COOKIE_SECURE` | Set to `true` only when served over HTTPS | No |

---

## API Endpoints

All `/api/` routes except auth require a valid session cookie (`outbound_forge_session`).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check — public |
| `POST` | `/api/auth/login` | Authenticate |
| `POST` | `/api/auth/logout` | Clear session |
| `GET` | `/api/auth/session` | Check session |
| `GET` | `/api/dashboard` | Full dashboard payload |
| `POST` | `/api/setup-request` | Submit manual report brief |
| `POST` | `/api/autonomous-runs` | Queue autonomous run |
| `GET` | `/api/plans/:id` | Fetch single report |
| `PATCH` | `/api/plans/:id/status` | Update report status |
| `PATCH` | `/api/plans/:id/checklist/:itemId` | Toggle checklist item |
| `POST` | `/api/plans/:id/send` | Schedule email sequence (requires `recipientEmail`) |
| `GET` | `/api/plans/:id/send-status` | Get send info + open/click stats |
| `GET` | `/api/autonomous-runs/:id` | Fetch autonomous run |
| `GET` | `/track/open/:trackingId` | Record email open → return 1x1 pixel (public) |
| `GET` | `/track/click/:trackingId?url=...` | Record click → redirect to url (public) |
| `GET` | `/audit/:auditPageId` | Render branded SEO audit report page (public — sent to prospects) |

---

## Data Model

Same shape as original (`server/data/db.json`), with these additions to report records:

### New report fields

- `prospectProfile` — AI-generated profile from Agent 1 (or `null` if AI failed/skipped)
- `seoAudit` — DataForSEO metrics from Agent 1.5: `{ domain, organicKeywords, monthlyTraffic, topKeywords, biggestGap }` (or `null` if skipped/failed)
- `auditPageId` — unique ID for the public audit report page, e.g. `audit_1720000000000_abc123`
- `auditPageUrl` — full public URL: `https://TRACKING_HOST/audit/:auditPageId`
- `sequenceSource` — `"ai"` | `"template"` — indicates which path generated the sequence
- `enrichedEmails` — array of contact email strings from Snov.io or pattern guessing
- `sendInfo` — `{scheduledAt, to, steps: [{step, trackingId}]}` — persisted after send

### Prospect profile shape (prospectProfile field)

```json
{
  "business_type": "Digital marketing agency",
  "top_gap": "Homepage has no clear CTA above the fold",
  "outreach_angle": "Show how fixing the CTA gap would increase their lead volume",
  "pain_match": "weak homepage CTA",
  "personalization_hook": "Your homepage buries the services section below three paragraphs of brand copy",
  "proof_present": false,
  "site_quality_score": 4
}
```

---

## AI Agent Architecture

### Agent 1.5 — SEO Audit (`agents/seoAudit.js`)
- **API:** DataForSEO Labs (HTTP Basic Auth: `DATAFORSEO_LOGIN:DATAFORSEO_PASSWORD`)
- **Input:** `domain`, `companyName`, `niche`, `location`
- **Calls:** `domain_rank_overview/live` + `ranked_keywords/live` in parallel
- **Output:** `{ organicKeywords, monthlyTraffic, topKeywords, biggestGap, fallback_used }`
- **Timeout:** 15s
- **Fallback:** `{ fallback_used: true, biggestGap: "Limited search visibility..." }`
- **Stored as:** `seoAudit` on the report record
- **Audit page:** auto-generated `auditPageId` → public URL `https://TRACKING_HOST/audit/:id`
- **Cost:** ~$0.002 per domain (DataForSEO pay-per-call)

### Agent 1 — Research (`agents/research.js`)
- **Model:** `gpt-4o-mini`
- **Input:** `websiteSnapshot` + `campaignContext`
- **Output:** prospect profile JSON
- **Timeout:** 15s
- **Fallback:** `{fallback_used: true}` — sequence falls back to template

### Agent 2 — Email Writer (`agents/emailWriter.js`)
- **Model:** `claude-sonnet-4-5`
- **Input:** `prospectProfile` + `campaignBrief`
- **Output:** `[{step, subject, body}, ...]`
- **Prompt caching:** system prompt + campaign brief are cached (ephemeral)
- **Timeout:** 30s
- **Fallback:** template sequence

### Agent 3A — Reply Classifier (`agents/classifier.js`)
- **Model:** `gpt-4o-mini`
- **Input:** `originalSubject`, `originalBody`, `replyBody`
- **Output:** `{classification, confidence, key_signal, return_date, also_unsubscribe}`
- **Classifications:** `INTERESTED | NOT_NOW | WRONG_PERSON | UNSUBSCRIBE | OUT_OF_OFFICE | OBJECTION | NOT_INTERESTED`
- **Timeout:** 10s

### Agent 3B — Reply Drafter (`agents/replyDrafter.js`)
- **Model:** `claude-sonnet-4-5`
- **Input:** `classification`, `prospectContext`, `originalEmail`, `replyBody`
- **Output:** `{subject, body, scheduled_followup_date, auto_send, internal_note}`
- **auto_send:** `true` only for UNSUBSCRIBE and OUT_OF_OFFICE
- **Timeout:** 20s

### Agent 4 — Optimizer (`agents/optimizer.js`)
- **Model:** `gpt-4o`
- **Input:** full campaign stats object
- **Output:** 13-field report (health, patterns, recommendations, hot leads, operator summary)
- **Timeout:** 30s
- **Usage:** call manually / on a weekly schedule

---

## Core Logic (`server/src/store.js`)

`store.js` owns all business logic. Key AI integration points:

- **`buildReportRecordFromInput(input, metadata)`** — fetches snapshots, then:
  1. Calls `researchProspect(websiteSnapshot, campaignContext)` → `prospectProfile`
  2. If profile succeeds: calls `writeEmailSequence(prospectProfile, campaignBrief)` → AI sequence
  3. If either fails: falls back to `buildSequenceFallback()` (template)
  4. Sets `sequenceSource: "ai"` or `"template"`

- **`processAutonomousRun(runId)`** — after qualifying each prospect:
  1. Calls `enrichProspect(prospect.domain)` → `enrichedEmails`
  2. Passes `enrichedEmails` to `buildReportRecordFromInput` as metadata

- **`scheduleSend(reportId, sendConfig)`** — creates tracking IDs per step, updates `report.sendInfo`, calls `scheduleSequence` from `sender.js`

- **`recordOpen(trackingId)` / `recordClick(trackingId, url)`** — in-memory tracking event storage

- **`getSendStatus(reportId)`** — returns `sendInfo` + per-step open/click counts

---

## Discovery (`server/src/discovery.js`)

- **`discoverProspects(query, count)`** — tries Google Maps first, falls back to Bing RSS
- **`discoverWithGoogleMaps(query, count)`** — Places Text Search endpoint
- **`enrichProspect(domain)`** — Snov.io two-step flow (OAuth token → domain emails), falls back to `guessEmailPatterns(domain)`
- **`fetchPageSnapshot(url)`** — identical to original, extracts title/description/h1/CTA/trust signals

---

## Sender (`server/src/sender.js`)

- **`sendEmail({to, subject, body, ...})`** — SMTP stub today; logs to console and returns `{sent: false, queued: true}` until nodemailer is installed. The file contains detailed TODO comments showing exact wiring.
- **`scheduleSequence(reportId, sequence, sendConfig)`** — uses `setTimeout` to schedule up to 3 steps (delays configurable via `delayDays`)
- **`cancelScheduledSequence(reportId)`** — clears all pending timers for a report
- **`buildOpenTrackingPixel(trackingId)`** / **`buildTrackedLink(url, trackingId)`** — uses `TRACKING_HOST` env var

To enable real sending:
```bash
cd server && npm install nodemailer
```
Then replace the stub block in `sender.js` (marked with `TODO: implement sending`).

---

## Frontend (`app.js` + `index.html`)

Key additions over the original:
- **Send modal** — pre-fills recipient from enriched emails; calls `POST /api/plans/:id/send`
- **Send status display** — shows open/click counts after send; calls `GET /api/plans/:id/send-status`
- **AI badges** — sequence cards tagged `Claude` when `sequenceSource === "ai"`
- **Prospect profile panel** — rendered in findings grid when `prospectProfile` is present
- **Enriched emails** — shown in summary + source grid

---

## Authentication & Security

Identical to original:
- In-memory session `Map`, 8-hour TTL
- HMAC-SHA256 signed tokens in `HttpOnly; SameSite=Strict` cookie
- Rate limits: 300 req/5min global, 10 login/15min per IP
- `timingSafeEqual` for password comparison
- Full security headers on every response
- Tracking routes (`/track/*`) skip auth — they're called by email clients

---

## Conventions

- **ESM throughout:** `import`/`export` only — no `require()`
- **No framework:** routing is a sequence of `if` checks in `index.js`
- **Synchronous DB writes:** `persistDb()` calls `fs.writeFileSync`
- **All mutations must call `persistDb()`** before returning
- **AI failures are non-fatal:** every agent call is wrapped in try/catch; the fallback path always produces a usable report
- **Tracking is in-memory only:** open/click events reset on server restart
- **Blocked domains** in `discovery.js` (19 entries)

---

## Differences from Original MailOutreach

| Feature | Original (`mailoutreach`) | AI Edition (`mailoutreach-ai`) |
|---|---|---|
| Port | 4020 | 4021 |
| Discovery | Bing RSS | Google Maps → Bing RSS fallback |
| Contact info | None | Snov.io enrichment |
| Email copy | Template | Claude Sonnet (GPT-4o mini research first) |
| Sending | Not implemented | SMTP stub (nodemailer TODO) |
| Tracking | None | Open pixel + click redirect |
| Reply handling | None | Classifier + drafter agents (call manually) |
| Optimization | None | Weekly optimizer agent (call manually) |

---

## Known Limitations (as of 2026-07)

- Tracking events are in-memory — resets on server restart
- SMTP sending is stubbed — must install nodemailer
- Reply classification and drafting agents (3A/3B) are not yet wired to an inbound inbox
- Optimizer (Agent 4) must be called manually with campaign data
- Sessions reset on server restart (same as original)
- JSON file storage — not suitable for concurrent writes
