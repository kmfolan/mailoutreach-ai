#!/usr/bin/env node
/**
 * build-hvac-list.mjs — CLI to build a Google-Contacts-ready CSV of HVAC leads.
 *
 * Pipeline: Google Maps discovery → Apollo owner+email enrichment →
 *           drop emailless rows, dedup → Google Contacts CSV.
 *
 * Usage (from repo root or server/):
 *   GOOGLE_MAPS_API_KEY=... APOLLO_API_KEY=... \
 *     node server/scripts/build-hvac-list.mjs --target 5000 --out hvac-leads.csv
 *
 * Flags:
 *   --target N       stop after N kept leads (default 5000)
 *   --out FILE       output CSV path (default hvac-leads.csv)
 *   --maps-only      skip Apollo; use role-based pattern emails (info@domain)
 *   --no-phone       skip Place Details phone lookups (fewer Maps calls)
 *   --self-test      run offline with mock data to validate CSV/dedup logic
 *
 * Environment egress required (won't run where these hosts are blocked):
 *   maps.googleapis.com   (discovery + phone)
 *   api.apollo.io         (owner + email; omit with --maps-only)
 */

import { writeFileSync } from "node:fs"

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const TARGET = parseInt(opt("--target", "5000"), 10)
const OUT = opt("--out", "hvac-leads.csv")
const MAPS_ONLY = flag("--maps-only")
const WITH_PHONE = !flag("--no-phone")
const SELF_TEST = flag("--self-test")

// ── Google Contacts CSV ─────────────────────────────────────────────────────
const HEADERS = [
  "Name", "Given Name", "Family Name", "Organization Name", "Organization Title",
  "E-mail 1 - Value", "Phone 1 - Value", "Website 1 - Value", "Address 1 - Formatted", "Notes"
]

function csvCell(value) {
  const s = value == null ? "" : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/)
  if (parts.length < 2) {
    return { given: parts[0] || "", family: "" }
  }
  return { given: parts[0], family: parts.slice(1).join(" ") }
}

function leadsToCsv(leads) {
  const rows = leads.map(lead => {
    const { given, family } = splitName(lead.contactName)
    return [
      lead.contactName || lead.company,
      given,
      family,
      lead.company,
      lead.title || "",
      lead.email,
      lead.phone || "",
      lead.website || "",
      lead.address || "",
      lead.emailSource ? `email via ${lead.emailSource}` : ""
    ]
  })
  return [HEADERS, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n"
}

// ── Self-test (offline) ──────────────────────────────────────────────────────
function runSelfTest() {
  const mockLeads = [
    { company: "Cool Air HVAC", contactName: "Jane Doe", title: "Owner", email: "jane@coolairhvac.com", emailSource: "apollo_search", website: "https://coolairhvac.com", domain: "coolairhvac.com", address: "12 Main St, Austin, TX", phone: "+1 512-555-0101" },
    { company: "Dup Co", contactName: "Jane Doe", title: "Owner", email: "jane@coolairhvac.com", emailSource: "apollo_search", website: "https://dup.com", domain: "dup.com", address: "", phone: "" },
    { company: "Comfort \"Pros\", LLC", contactName: "Bob", title: "President", email: "bob@comfortpros.com", emailSource: "apollo_match", website: "https://comfortpros.com", domain: "comfortpros.com", address: "5 Elm, Denver, CO", phone: "+1 303-555-0123" }
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

  console.log(`Building up to ${TARGET} HVAC leads (${MAPS_ONLY ? "Maps + pattern emails" : "Maps + Apollo"})…`)
  const started = Date.now()

  const leads = await buildHvacLeads({
    target: TARGET,
    useApollo: !MAPS_ONLY,
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
