#!/usr/bin/env node
/**
 * hvac-mcp.mjs — MCP connector for the MailOutreach HVAC lead-gen endpoint.
 *
 * Exposes three tools to an MCP client (e.g. Claude Desktop):
 *   start_hvac_run   — kick off an async lead-gen job
 *   hvac_run_status  — poll a job's progress
 *   download_hvac_csv — save the finished CSV to disk
 *
 * It handles session login to your server and reuses the cookie. Point it at a
 * deployed instance (droplet) so the API keys stay server-side.
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdio (the MCP stdio spec).
 * Dependencies: Node 18+ built-ins only. No npm install.
 *
 * Configure via env (set these in the Claude Desktop config, see README.md):
 *   MAILOUTREACH_BASE_URL   e.g. https://your-droplet.example.com
 *   MAILOUTREACH_USERNAME   app login username
 *   MAILOUTREACH_PASSWORD   app login password
 */

import { writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import readline from "node:readline"

const BASE_URL = (process.env.MAILOUTREACH_BASE_URL || "").replace(/\/+$/, "")
const USERNAME = process.env.MAILOUTREACH_USERNAME || "admin"
const PASSWORD = process.env.MAILOUTREACH_PASSWORD || ""

const SERVER_INFO = { name: "mailoutreach-hvac", version: "1.0.0" }
const DEFAULT_PROTOCOL = "2024-11-05"

let cookie = ""

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function extractSessionCookie(response) {
  const raw =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean)
  for (const line of raw) {
    const first = String(line).split(";")[0]
    if (first.startsWith("outbound_forge_session=")) {
      return first
    }
  }
  return ""
}

async function login() {
  if (!BASE_URL) {
    throw new Error("MAILOUTREACH_BASE_URL is not set")
  }
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD })
  })
  if (!response.ok) {
    throw new Error(`Login failed (${response.status}). Check MAILOUTREACH_USERNAME / MAILOUTREACH_PASSWORD.`)
  }
  cookie = extractSessionCookie(response)
  if (!cookie) {
    throw new Error("Login succeeded but no session cookie was returned.")
  }
}

async function apiFetch(pathname, options = {}, retry = true) {
  if (!cookie) {
    await login()
  }
  const response = await fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: { ...(options.headers || {}), Cookie: cookie }
  })
  if (response.status === 401 && retry) {
    cookie = ""
    return apiFetch(pathname, options, false)
  }
  return response
}

// ── Tool implementations ─────────────────────────────────────────────────────

async function startHvacRun(args = {}) {
  const mode = String(args.mode || "standard").toLowerCase()
  const target = Math.min(Math.max(parseInt(args.target, 10) || 1000, 1), 5000)
  const response = await apiFetch("/api/hvac-leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, target, smtp: Boolean(args.smtp) })
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Server returned ${response.status}`)
  }
  const job = data.job
  return (
    `Started HVAC run.\n` +
    `  job id: ${job.id}\n  mode: ${job.mode}\n  target: ${job.target}\n  status: ${job.status}\n\n` +
    `Poll with hvac_run_status using this job id; download with download_hvac_csv once it's "done".`
  )
}

async function hvacRunStatus(args = {}) {
  const jobId = String(args.job_id || "").trim()
  if (!jobId) {
    throw new Error("job_id is required")
  }
  const response = await apiFetch(`/api/hvac-leads/${encodeURIComponent(jobId)}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Server returned ${response.status}`)
  }
  const job = data.job
  return (
    `Job ${job.id}\n  status: ${job.status}\n  leads kept: ${job.kept} / ${job.target}\n` +
    (job.error ? `  error: ${job.error}\n` : "") +
    (job.downloadReady ? `  ✓ ready to download` : `  (not ready to download yet)`)
  )
}

async function downloadHvacCsv(args = {}) {
  const jobId = String(args.job_id || "").trim()
  if (!jobId) {
    throw new Error("job_id is required")
  }
  const response = await apiFetch(`/api/hvac-leads/${encodeURIComponent(jobId)}/download`)
  if (response.status === 409) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || "Job is not ready yet.")
  }
  if (!response.ok) {
    throw new Error(`Server returned ${response.status}`)
  }
  const csv = await response.text()
  const outPath = args.out_path
    ? path.resolve(args.out_path)
    : path.join(homedir(), `hvac-leads-${jobId}.csv`)
  writeFileSync(outPath, csv, "utf8")
  const rows = Math.max(0, csv.trim().split(/\r?\n/).length - 1)
  return `Saved ${rows} leads to:\n  ${outPath}\n\nImport at contacts.google.com → Import.`
}

const TOOLS = [
  {
    name: "start_hvac_run",
    description:
      "Start an async HVAC lead-gen job on the MailOutreach server. Returns a job id to poll. " +
      "Modes: standard (Maps→Apollo→scrape→verify), comprehensive (also pattern emails), " +
      "maps-only (no Apollo), apollo-only (no scraping).",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["standard", "comprehensive", "maps-only", "apollo-only"],
          description: "Enrichment mode (default standard)"
        },
        target: { type: "integer", description: "Number of leads to collect (max 5000, default 1000)" },
        smtp: { type: "boolean", description: "Also SMTP-probe mailboxes (slower). Default false." }
      }
    }
  },
  {
    name: "hvac_run_status",
    description: "Check the status and progress of an HVAC lead-gen job by its job id.",
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string", description: "The job id from start_hvac_run" } },
      required: ["job_id"]
    }
  },
  {
    name: "download_hvac_csv",
    description:
      "Download the finished HVAC leads CSV to disk (only works once the job status is 'done'). " +
      "Saves to the home directory by default, or to out_path if given.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "The job id from start_hvac_run" },
        out_path: { type: "string", description: "Optional file path to save the CSV to" }
      },
      required: ["job_id"]
    }
  }
]

async function callTool(name, args) {
  if (name === "start_hvac_run") return startHvacRun(args)
  if (name === "hvac_run_status") return hvacRunStatus(args)
  if (name === "download_hvac_csv") return downloadHvacCsv(args)
  throw new Error(`Unknown tool: ${name}`)
}

// ── JSON-RPC / MCP stdio loop ────────────────────────────────────────────────

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n")
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result })
}

function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } })
}

async function handleMessage(msg) {
  const { id, method, params } = msg

  // Notifications (no id) get no response.
  if (id === undefined || id === null) {
    return
  }

  try {
    if (method === "initialize") {
      reply(id, {
        protocolVersion: params?.protocolVersion || DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO
      })
    } else if (method === "tools/list") {
      reply(id, { tools: TOOLS })
    } else if (method === "tools/call") {
      try {
        const text = await callTool(params?.name, params?.arguments || {})
        reply(id, { content: [{ type: "text", text }] })
      } catch (toolError) {
        reply(id, { content: [{ type: "text", text: `Error: ${toolError.message}` }], isError: true })
      }
    } else if (method === "ping") {
      reply(id, {})
    } else {
      replyError(id, -32601, `Method not found: ${method}`)
    }
  } catch (error) {
    replyError(id, -32603, error.message)
  }
}

const rl = readline.createInterface({ input: process.stdin })
rl.on("line", line => {
  const trimmed = line.trim()
  if (!trimmed) {
    return
  }
  let msg
  try {
    msg = JSON.parse(trimmed)
  } catch {
    return
  }
  handleMessage(msg)
})
