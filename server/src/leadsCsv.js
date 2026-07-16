/**
 * leadsCsv.js — render lead records as a Google-Contacts-ready CSV.
 *
 * Shared by the CLI (build-hvac-list.mjs) and the async API job runner
 * (hvacJobs.js) so the export format lives in exactly one place.
 *
 * The header row matches Google Contacts' import template, so the output
 * imports directly at contacts.google.com → Import.
 */

export const GOOGLE_CONTACTS_HEADERS = [
  "Name",
  "Given Name",
  "Family Name",
  "Organization Name",
  "Organization Title",
  "E-mail 1 - Value",
  "Phone 1 - Value",
  "Website 1 - Value",
  "Address 1 - Formatted",
  "Notes"
]

export function csvCell(value) {
  const s = value == null ? "" : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) {
    return { given: parts[0] || "", family: "" }
  }
  return { given: parts[0], family: parts.slice(1).join(" ") }
}

export function leadsToCsv(leads) {
  const rows = leads.map(lead => {
    const { given, family } = splitName(lead.contactName)
    const note = [lead.emailSource ? `email via ${lead.emailSource}` : "", lead.verifyStatus]
      .filter(Boolean)
      .join(" · ")
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
      note
    ]
  })
  return [GOOGLE_CONTACTS_HEADERS, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n"
}
