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

## Pipeline

```
Google Maps Places  →  Apollo (by domain)  →  filter no-email + dedup  →  Google CSV
   name, website,        owner name,             one row per company/email     import-ready
   domain, address,      title, real email
   phone
```

Code:
- `server/src/hvacLeads.js` — orchestrator (`buildHvacLeads`), paginated Maps
  search, Place Details phone lookup.
- `server/src/apollo.js` — Apollo People Search + Match (`findOwnerContact`).
- `server/scripts/build-hvac-list.mjs` — CLI + Google CSV writer + self-test.

## Requirements

| Env var | Purpose | Where |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | discovery + phone | Google Cloud → Places API |
| `APOLLO_API_KEY` | owner name + email | https://developer.apollo.io → API Keys |

Node 18+. No npm install (Node built-ins + global `fetch`).

## Run

```bash
# Full pipeline (Maps + Apollo)
GOOGLE_MAPS_API_KEY=... APOLLO_API_KEY=... \
  node server/scripts/build-hvac-list.mjs --target 5000 --out hvac-leads.csv

# Company skeleton only, no Apollo (role-based info@ emails)
GOOGLE_MAPS_API_KEY=... node server/scripts/build-hvac-list.mjs --maps-only

# Validate CSV/dedup logic offline (no network, no keys)
npm --prefix server run hvac-list:test
```

Flags: `--target N`, `--out FILE`, `--maps-only`, `--no-phone`, `--self-test`.

Import the resulting CSV at **contacts.google.com → Import**.

## Where it runs

The script needs outbound network access to `maps.googleapis.com` and
`api.apollo.io`. It runs anywhere that egress is open — your local machine or
the production droplet.

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
