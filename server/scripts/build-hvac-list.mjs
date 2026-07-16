#!/usr/bin/env node
/**
 * build-hvac-list.mjs — CLI to build a Google-Contacts-ready CSV of HVAC leads.
 *
 * Waterfall: Google Maps discovery → Apollo owner+email → website-scrape
 *            fallback → pattern fallback → MX/SMTP verify → drop emailless,
 *            dedup → Google Contacts CSV.
 *
 * Usage (from repo root or server/):
 *   GOOGLE_MAPS_API_KEY=... APOLLO_API_KEY=... \
 *     node server/scripts/build-hvac-list.mjs --target 5000 --out hvac-leads.csv
 *
 * Flags:
 *   --target N       stop after N kept leads (default 5000)
 *   --out FILE       output CSV path (default hvac-leads.csv)
 *   --maps-only      skip Apollo (Maps + website scrape only)
 *   --no-scrape      disable the website-scrape fallback (Layer 3)
 *   --patterns       allow last-resort role emails (info@domain) (Layer 4)
 *   --comprehensive  max coverage: scrape + patterns + verify all on
 *   --no-verify      skip MX verification (Layer 5)
 *   --smtp           also SMTP-probe mailboxes (slow, opt-in)
 *   --from ADDR      MAIL FROM identity for SMTP probing
 *   --no-phone       skip Place Details phone lookups (fewer Maps calls)
 *   --self-test      run offline with mock data to validate CSV/dedup logic
 *
 * Environment egress required (won't run where these hosts are blocked):
 *   maps.googleapis.com   (discovery + phone)
 *   api.apollo.io         (owner + email; omit with --maps-only)
 *   company websites      (scrape fallback; omit with --no-scrape)
 */

import { writeFileSync } from "node:fs"
import { leadsToCsv } from "../src/leadsCsv.js"

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const TARGET = parseInt(opt("--target", "5000"), 10)
const OUT = opt("--out", "hvac-leads.csv")
const MAPS_ONLY = flag("--maps-only")
const COMPREHENSIVE = flag("--comprehensive")
const NO_SCRAPE = flag("--no-scrape")
const PATTERNS = flag("--patterns") || COMPREHENSIVE
const NO_VERIFY = flag("--no-verify")
const SMTP = flag("--smtp")
const FROM = opt("--from", "verify@example.com")
const WITH_PHONE = !flag("--no-phone")
const SELF_TEST = flag("--self-test")

// CSV rendering is shared with the API job runner via ../src/leadsCsv.js.

// ── Self-test (offline) ──────────────────────────────────────────────────────
function runSelfTest() {
  const mockLeads = [
    { company: "Cool Air HVAC", contactName: "Jane Doe", title: "Owner", email: "jane@coolairhvac.com", emailSource: "apollo_search", verifyStatus: "valid-mx", website: "https://coolairhvac.com", domain: "coolairhvac.com", address: "12 Main St, Austin, TX", phone: "+1 512-555-0101" },
    { company: "Dup Co", contactName: "Jane Doe", title: "Owner", email: "jane@coolairhvac.com", emailSource: "apollo_search", verifyStatus: "valid-mx", website: "https://dup.com", domain: "dup.com", address: "", phone: "" },
    { company: "Comfort \"Pros\", LLC", contactName: "Bob", title: "President", email: "bob@comfortpros.com", emailSource: "website", verifyStatus: "smtp-ok", website: "https://comfortpros.com", domain: "comfortpros.com", address: "5 Elm, Denver, CO", phone: "+1 303-555-0123" }
  ]
  // Dedup by email (mirrors buildHvacLeads' seenEmail guard).
  const seen = new Set()
  const deduped = mockLeads.filter(l => (seen.has(l.email) ? false : (seen.add(l.email), true)))
  const csv = leadsToCsv(deduped)
  writeFileSync(OUT, csv, "utf8")
  const lines = csv.trim().split("\r\n")
  console.log(`[self-test] ${deduped.length} leads (1 dup dropped) → ${OUT}`)
  console.log(`[self-test] header cols: ${lines[0].split(",").length}`)
  console.log("[self-test] sample row:", lines[2])
  const ok = deduped.length === 2 && lines.length === 3 && lines[0].startsWith("Name,")
  console.log(ok ? "[self-test] PASS" : "[self-test] FAIL")
  process.exit(ok ? 0 : 1)
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (SELF_TEST) {
    runSelfTest()
    return
  }

  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.error("GOOGLE_MAPS_API_KEY is required (get one in Google Cloud → Places API).")
    process.exit(1)
  }
  if (!MAPS_ONLY && !process.env.APOLLO_API_KEY) {
    console.error("APOLLO_API_KEY is required unless you pass --maps-only.")
    console.error("Get one at https://developer.apollo.io → API Keys.")
    process.exit(1)
  }

  const { buildHvacLeads } = await import("../src/hvacLeads.js")

  const layers = [
    "Maps",
    MAPS_ONLY ? null : "Apollo",
    NO_SCRAPE ? null : "scrape",
    PATTERNS ? "patterns" : null,
    NO_VERIFY ? null : (SMTP ? "verify(smtp)" : "verify(mx)")
  ].filter(Boolean)
  console.log(`Building up to ${TARGET} HVAC leads [${layers.join(" → ")}]…`)
  const started = Date.now()

  const leads = await buildHvacLeads({
    target: TARGET,
    useApollo: !MAPS_ONLY,
    scrape: !NO_SCRAPE,
    patterns: PATTERNS,
    verify: !NO_VERIFY,
    smtp: SMTP,
    from: FROM,
    withPhone: WITH_PHONE,
    onProgress: (n) => {
      if (n % 25 === 0 || n === 1) {
        process.stdout.write(`\r  ${n} leads kept…`)
      }
    }
  })

  writeFileSync(OUT, leadsToCsv(leads), "utf8")
  const secs = Math.round((Date.now() - started) / 1000)
  console.log(`\n✅ ${leads.length} leads (all with email) → ${OUT}  [${secs}s]`)
  console.log("   Import at contacts.google.com → Import.")
}

main().catch(err => {
  console.error(`\n✗ ${err.message}`)
  process.exit(1)
})
