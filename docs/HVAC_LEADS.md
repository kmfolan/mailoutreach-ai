# HVAC Lead-Gen Pipeline

Build a Google-Contacts-ready CSV of HVAC companies with an **owner name +
verified email**, by matching **Google Maps** discovery to **Apollo.io**
enrichment.

> **Why this design.** Google Maps knows the company, website, address, and
> phone — but never the owner's email. Apollo knows the people and their
> emails, keyed on a domain. Matching Maps → Apollo by domain gives a
> personalized contact that neither source produces alone. (Direct LinkedIn
> scraping was considered and rejected: it violates LinkedIn's ToS and is
> fragile; Apollo exposes the same LinkedIn-sourced data legitimately via API.)

## Pipeline (enrichment waterfall)

Each company flows through layers until it has a deliverable email; anything
that reaches the end without one is dropped.

| # | Layer | Source | Yields |
|---|-------|--------|--------|
| 1 | Discovery | Google Maps Places (paginated) | company, website, domain, address, phone |
| 2 | Primary enrichment | Apollo (match by domain) | owner name + title + real email |
| 3 | Fallback enrichment | scrape the company's own site | role email (`owner@`, `info@`) |
| 4 | Last resort | pattern guess | `info@domain` (opt-in, `--patterns`) |
| 5 | Verification | DNS MX (+ optional SMTP) | drop dead domains / rejected mailboxes |

Then: drop no-email, dedup by domain + email → Google Contacts CSV.

Code:
- `server/src/hvacLeads.js` — orchestrator (`buildHvacLeads`), paginated Maps
  search, Place Details phone lookup, the waterfall.
- `server/src/apollo.js` — Apollo People Search + Match (`findOwnerContact`).
- `server/src/discovery.js` — website email scraping (`scrapeSiteEmails`,
  `extractEmailsFromHtml`, `pickBestEmail`, `isJunkEmail`).
- `server/src/emailVerify.js` — MX / SMTP verification (`verifyEmail`).
- `server/scripts/build-hvac-list.mjs` — CLI + Google CSV writer + self-test.

## Requirements

| Env var | Purpose | Where |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | discovery + phone | Google Cloud → Places API |
| `APOLLO_API_KEY` | owner name + email | https://developer.apollo.io → API Keys |

Node 18+. No npm install (Node built-ins + global `fetch`).

## Run

```bash
# Default waterfall (Maps → Apollo → scrape → MX-verify)
GOOGLE_MAPS_API_KEY=... APOLLO_API_KEY=... \
  node server/scripts/build-hvac-list.mjs --target 5000 --out hvac-leads.csv

# Most comprehensive: also allow pattern emails, verify everything
GOOGLE_MAPS_API_KEY=... APOLLO_API_KEY=... \
  node server/scripts/build-hvac-list.mjs --comprehensive --target 5000

# No Apollo — Maps + website scraping only (no Apollo key needed)
GOOGLE_MAPS_API_KEY=... node server/scripts/build-hvac-list.mjs --maps-only

# Validate CSV/dedup logic offline (no network, no keys)
npm --prefix server run hvac-list:test
```

Flags: `--target N`, `--out FILE`, `--maps-only`, `--no-scrape`, `--patterns`,
`--comprehensive`, `--no-verify`, `--smtp`, `--from ADDR`, `--no-phone`,
`--self-test`.

Import the resulting CSV at **contacts.google.com → Import**.

## Where it runs

The script needs outbound network access to `maps.googleapis.com`,
`api.apollo.io`, and the company websites it scrapes. It runs anywhere that
egress is open — your local machine or the production droplet.

> **Note on Claude Code web sessions.** The managed cloud environment uses an
> allowlist egress policy. `maps.googleapis.com` is reachable, but
> `api.apollo.io` is blocked by default, so the full pipeline can't execute in
> a web session until `api.apollo.io` is added to the environment's network
> allowlist. `--maps-only` runs in-session (Maps is permitted), producing the
> company list with role-based emails.

## Notes & limits

- **Email fill rate depends on Apollo coverage.** Companies Apollo doesn't have,
  or whose email your plan won't unlock, are skipped (requirement: never export
  a contact without an email). Reaching 5,000 may mean scanning more companies.
- **Apollo credits.** Revealing emails via People Match consumes Apollo credits;
  budget accordingly for large targets.
- **Dedup** is by domain and by email.
- **Compliance.** You're sending cold email — follow CAN-SPAM / GDPR (valid
  physical address, working unsubscribe, honor opt-outs).
