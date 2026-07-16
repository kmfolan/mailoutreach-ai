/**
 * hvacJobs.js — async job runner for the HVAC lead-gen waterfall.
 *
 * A 5,000-lead run takes many minutes — far longer than an HTTP request should
 * stay open. So the API starts a background job and returns an id; callers poll
 * status and download the CSV when it's ready. Both Claude on the web and
 * Claude Desktop can drive the same endpoint this way.
 *
 * Jobs live in memory (same convention as the app's tracking store); they reset
 * on server restart. For durability across restarts, persist to db.json.
 *
 * Dependencies: Node built-ins. buildHvacLeads is imported lazily so the module
 * loads even when discovery deps aren't needed.
 */

import crypto from "crypto"
import { leadsToCsv } from "./leadsCsv.js"

const jobs = new Map()
const MAX_TARGET = 5000
const JOB_TTL_MS = 60 * 60 * 1000 // keep finished jobs 1h for download

// Map a friendly mode to waterfall layer toggles.
export function resolveMode(mode) {
  switch (String(mode || "standard").toLowerCase()) {
    case "comprehensive":
      return { useApollo: true, scrape: true, patterns: true, verify: true }
    case "maps-only":
      return { useApollo: false, scrape: true, patterns: false, verify: true }
    case "apollo-only":
      return { useApollo: true, scrape: false, patterns: false, verify: true }
    case "standard":
    default:
      return { useApollo: true, scrape: true, patterns: false, verify: true }
  }
}

function publicView(job) {
  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    target: job.target,
    kept: job.kept,
    error: job.error,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    downloadReady: job.status === "done" && job.kept > 0
  }
}

function sweepExpiredJobs() {
  const now = Date.now()
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS) {
      jobs.delete(id)
    }
  }
}

/**
 * Start a job. Returns the public status view immediately; the run continues
 * in the background.
 */
export function startHvacJob(options = {}) {
  sweepExpiredJobs()

  const target = Math.min(Math.max(parseInt(options.target, 10) || 1000, 1), MAX_TARGET)
  const mode = String(options.mode || "standard").toLowerCase()
  const layers = resolveMode(mode)

  const job = {
    id: `hvac_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    status: "running",
    mode,
    target,
    kept: 0,
    error: null,
    csv: null,
    createdAt: new Date().toISOString(),
    finishedAt: null
  }
  jobs.set(job.id, job)

  // Fire-and-forget; the async function keeps running on the event loop.
  ;(async () => {
    try {
      const { buildHvacLeads } = await import("./hvacLeads.js")
      const leads = await buildHvacLeads({
        target,
        ...layers,
        smtp: Boolean(options.smtp),
        from: options.from || "verify@example.com",
        cities: options.cities,
        terms: options.terms,
        onProgress: n => {
          job.kept = n
        }
      })
      job.csv = leadsToCsv(leads)
      job.kept = leads.length
      job.status = "done"
    } catch (error) {
      job.status = "error"
      job.error = error.message
    } finally {
      job.finishedAt = Date.now()
    }
  })()

  return publicView(job)
}

export function getHvacJob(id) {
  const job = jobs.get(id)
  return job ? publicView(job) : null
}

export function getHvacJobCsv(id) {
  const job = jobs.get(id)
  if (!job || job.status !== "done" || !job.csv) {
    return null
  }
  return job.csv
}
