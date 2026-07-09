/**
 * sender.js — Multi-provider email sending layer
 *
 * Supports Microsoft 365, Google Workspace (Gmail), and Turbify/Yahoo Business.
 * Accounts are loaded from (in priority order):
 *   1. server/data/smtp-accounts.json  — unlimited accounts, preferred for scale
 *   2. Numbered env vars SMTP_1_* … SMTP_20_*  — simple multi-account setup
 *   3. Legacy SMTP_HOST / SMTP_USER / SMTP_PASS  — single-account fallback
 *
 * smtp-accounts.json format:
 *   [
 *     { "provider": "microsoft", "user": "x@domain.com", "pass": "app-pw", "fromName": "Name" },
 *     { "provider": "gmail",     "user": "y@domain.com", "pass": "app-pw", "fromName": "Name" },
 *     { "provider": "turbify",   "user": "z@domain.com", "pass": "app-pw" }
 *   ]
 * Add as many objects as needed — no limit. Omit host/port/secure to use provider preset.
 *
 * To activate real sending:
 *   cd server && npm install nodemailer
 *   Then uncomment the nodemailer block in sendEmail() below.
 */

import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const SMTP_ACCOUNTS_FILE = join(__dirname, "../../data/smtp-accounts.json")

// ---------------------------------------------------------------------------
// Open/click tracking helpers
// ---------------------------------------------------------------------------

export function buildOpenTrackingPixel(trackingId) {
  const host = process.env.TRACKING_HOST || "localhost:4021"
  return (
    `<img src="https://${host}/track/open/${trackingId}" ` +
    `width="1" height="1" style="display:none" alt="">`
  )
}

export function buildTrackedLink(url, trackingId) {
  const host = process.env.TRACKING_HOST || "localhost:4021"
  return `https://${host}/track/click/${trackingId}?url=${encodeURIComponent(url)}`
}

// ---------------------------------------------------------------------------
// SMTP provider presets
// ---------------------------------------------------------------------------

/**
 * Known provider presets. Setting SMTP_n_PROVIDER=microsoft|gmail|yahoo
 * fills in host/port/secure automatically — override any field explicitly.
 *
 * DELIVERABILITY NOTES (honest assessment):
 *
 * microsoft — Best overall for cold B2B outreach. Office 365 IPs have the
 *   strongest reputation with corporate spam filters. Most outreach agencies
 *   use this. $6/mailbox/month. Recommended primary provider.
 *
 * gmail — Excellent inbox placement especially for Gmail recipients (~40% of
 *   all inboxes). Google aggressively detects cold outreach patterns and will
 *   suspend accounts faster than Microsoft. Good for B2C or low-volume sends.
 *   $6/mailbox/month (Google Workspace — not free @gmail.com accounts).
 *
 * yahoo/turbify — Cheapest at ~$1.50/mailbox. Yahoo's IP pool has historically
 *   weaker reputation than Microsoft/Google for cold outreach. Deliverability
 *   is acceptable for warmed-up domains but expect higher spam placement rates
 *   vs Microsoft 365 at scale. Best used for testing or lower-priority sequences.
 *
 * Verdict: Microsoft 365 > Google Workspace > Turbify/Yahoo for cold B2B.
 * Domain age + SPF/DKIM/DMARC setup matters more than provider choice — a
 * well-configured domain on Yahoo will beat a poorly configured M365 account.
 */
const PROVIDER_PRESETS = {
  microsoft: { host: "smtp.office365.com",     port: 587, secure: false },
  gmail:     { host: "smtp.gmail.com",          port: 587, secure: false },
  yahoo:     { host: "smtp.bizmail.yahoo.com",  port: 465, secure: true  },
  turbify:   { host: "smtp.bizmail.yahoo.com",  port: 465, secure: true  },
}

// ---------------------------------------------------------------------------
// SMTP account pool
// ---------------------------------------------------------------------------

/**
 * Load all configured SMTP accounts from environment variables.
 *
 * Pattern 1 — numbered multi-account (preferred for production):
 *   SMTP_1_PROVIDER=microsoft
 *   SMTP_1_USER=outreach@yourdomain.com
 *   SMTP_1_PASS=app-password
 *   SMTP_1_FROM_NAME=Your Name
 *   (SMTP_1_HOST / SMTP_1_PORT / SMTP_1_SECURE are optional — filled by preset)
 *
 *   SMTP_2_PROVIDER=gmail
 *   SMTP_2_USER=outreach2@yourdomain.com
 *   SMTP_2_PASS=app-password
 *   ...up to SMTP_20_*
 *
 * Pattern 2 — legacy single account (fallback):
 *   SMTP_HOST=smtp.office365.com
 *   SMTP_PORT=587
 *   SMTP_SECURE=false
 *   SMTP_USER=outreach@yourdomain.com
 *   SMTP_PASS=app-password
 *   SMTP_PROVIDER=microsoft  (optional — for labeling)
 *
 * @returns {Array<{index, provider, host, port, secure, user, pass, fromName}>}
 */
export function loadSmtpAccounts() {
  // ── Priority 1: JSON file (unlimited accounts) ──────────────────────────────
  if (existsSync(SMTP_ACCOUNTS_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(SMTP_ACCOUNTS_FILE, "utf8"))
      if (Array.isArray(raw) && raw.length > 0) {
        return raw
          .filter(a => a.user && a.pass)
          .map((a, i) => {
            const provider = (a.provider || "").toLowerCase()
            const preset   = PROVIDER_PRESETS[provider] || {}
            return {
              index:    i,
              provider: provider || "custom",
              host:     a.host     || preset.host    || "smtp.office365.com",
              port:     Number(a.port || preset.port || 587),
              secure:   a.secure   ?? preset.secure  ?? false,
              user:     a.user,
              pass:     a.pass,
              fromName: a.fromName || "",
            }
          })
      }
    } catch (err) {
      console.error(`[sender] Failed to parse ${SMTP_ACCOUNTS_FILE}: ${err.message}`)
    }
  }

  const accounts = []

  // ── Priority 2: Numbered env vars SMTP_1_* … SMTP_20_* ─────────────────────
  for (let i = 1; i <= 20; i++) {
    const user = process.env[`SMTP_${i}_USER`]
    const pass = process.env[`SMTP_${i}_PASS`]
    if (!user || !pass) continue

    const provider = (process.env[`SMTP_${i}_PROVIDER`] || "").toLowerCase()
    const preset = PROVIDER_PRESETS[provider] || {}

    accounts.push({
      index:    i,
      provider: provider || "custom",
      host:     process.env[`SMTP_${i}_HOST`]      || preset.host    || "smtp.office365.com",
      port:     Number(process.env[`SMTP_${i}_PORT`] || preset.port  || 587),
      secure:   process.env[`SMTP_${i}_SECURE`] === "true" || preset.secure || false,
      user,
      pass,
      fromName: process.env[`SMTP_${i}_FROM_NAME`] || process.env.SMTP_FROM_NAME || "",
    })
  }
  if (accounts.length > 0) return accounts

  // ── Priority 3: Legacy single-account fallback ──────────────────────────────
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    const provider = (process.env.SMTP_PROVIDER || "").toLowerCase()
    const preset   = PROVIDER_PRESETS[provider] || {}
    return [{
      index:    0,
      provider: provider || "custom",
      host:     process.env.SMTP_HOST     || preset.host  || "smtp.office365.com",
      port:     Number(process.env.SMTP_PORT || preset.port || 587),
      secure:   process.env.SMTP_SECURE   === "true" || preset.secure || false,
      user:     process.env.SMTP_USER,
      pass:     process.env.SMTP_PASS,
      fromName: process.env.SMTP_FROM_NAME || "",
    }]
  }

  return accounts
}

// Round-robin counter (module-level, resets on server restart)
let _rrIndex = 0

/**
 * Return the next SMTP account in round-robin order.
 * Returns null if no accounts are configured.
 */
export function getNextSmtpAccount() {
  const accounts = loadSmtpAccounts()
  if (accounts.length === 0) return null
  const account = accounts[_rrIndex % accounts.length]
  _rrIndex++
  return account
}

/**
 * Return all configured accounts (for dashboard display / health checks).
 */
export function listSmtpAccounts() {
  return loadSmtpAccounts().map(a => ({
    index:    a.index,
    provider: a.provider,
    user:     a.user,
    host:     a.host,
    port:     a.port,
  }))
}

// ---------------------------------------------------------------------------
// Core send function
// ---------------------------------------------------------------------------

/**
 * Send a single email via SMTP.
 *
 * @param {{ to, subject, body, from?, replyTo?, trackingId, reportId, smtpAccount? }} opts
 *   smtpAccount — if provided, uses this account; otherwise picks next in round-robin
 */
export async function sendEmail({ to, subject, body, from, replyTo, trackingId, reportId, smtpAccount }) {
  const account = smtpAccount || getNextSmtpAccount()

  if (!account) {
    console.log(`📧 [SMTP NOT CONFIGURED] Would send to: ${to} | Subject: ${subject}`)
    return { sent: false, reason: "smtp_not_configured", queued: true, to, subject }
  }

  // ── Activate real sending ─────────────────────────────────────────────────
  // 1. Install nodemailer:  cd server && npm install nodemailer
  // 2. Add this import at the top of the file:
  //      import nodemailer from "nodemailer"
  // 3. Replace the stub return below with this block:
  //
  //   const transporter = nodemailer.createTransport({
  //     host:   account.host,
  //     port:   account.port,
  //     secure: account.secure,
  //     auth:   { user: account.user, pass: account.pass },
  //   })
  //
  //   const fromAddress = from || (account.fromName
  //     ? `"${account.fromName}" <${account.user}>`
  //     : account.user)
  //
  //   const htmlBody =
  //     `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#222">` +
  //     body.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>") +
  //     `</div>` +
  //     buildOpenTrackingPixel(trackingId)
  //
  //   try {
  //     const info = await transporter.sendMail({
  //       from:    fromAddress,
  //       to,
  //       replyTo: replyTo || fromAddress,
  //       subject,
  //       text:    body,
  //       html:    htmlBody,
  //     })
  //     console.log(`📧 [SENT] ${account.provider} | ${account.user} → ${to} | ${subject}`)
  //     return { sent: true, messageId: info.messageId, to, subject, provider: account.provider, smtpUser: account.user }
  //   } catch (smtpErr) {
  //     console.error(`📧 [SMTP ERROR] ${account.provider} | ${account.user}: ${smtpErr.message}`)
  //     return { sent: false, reason: smtpErr.message, to, subject, provider: account.provider, smtpUser: account.user }
  //   }
  // ─────────────────────────────────────────────────────────────────────────

  console.log(
    `📧 [NODEMAILER PENDING] Install nodemailer to activate.\n` +
    `   Provider: ${account.provider} (${account.user}) → ${to} | ${subject}`
  )
  return {
    sent:     false,
    reason:   "nodemailer_not_installed",
    queued:   true,
    to,
    subject,
    provider: account.provider,
    smtpUser: account.user,
  }
}

// ---------------------------------------------------------------------------
// Sequence scheduler
// ---------------------------------------------------------------------------

/**
 * Tracks pending timer handles indexed by reportId.
 * @type {Map<string, ReturnType<typeof setTimeout>[]>}
 */
export const scheduledSequences = new Map()

/**
 * Schedule a 3-step outreach sequence.
 * Each step is pre-assigned an SMTP account at schedule time so the round-robin
 * is deterministic — account 1 gets Email 1, account 2 gets Email 2, etc.
 *
 * @param {string} reportId
 * @param {Array<{step, subject, body}>} sequence
 * @param {{ from?, replyTo?, toEmail, toName?, delayDays? }} sendConfig
 */
export async function scheduleSequence(reportId, sequence, sendConfig) {
  cancelScheduledSequence(reportId)

  const { from, replyTo, toEmail, delayDays = [0, 3, 7] } = sendConfig
  const steps = sequence.slice(0, 3)
  const handles = []
  const scheduledSteps = []

  steps.forEach((step, index) => {
    const daysDelay = delayDays[index] !== undefined ? delayDays[index] : index * 3
    const delayMs   = daysDelay === 0 ? 500 : daysDelay * 24 * 60 * 60 * 1000
    const scheduledAt = new Date(Date.now() + delayMs).toISOString()

    // Pre-assign account now so round-robin is stable across restarts
    const smtpAccount = getNextSmtpAccount()

    const handle = setTimeout(() => {
      sendEmail({
        to:          toEmail,
        subject:     step.subject,
        body:        step.body,
        from,
        replyTo,
        trackingId:  `${reportId}_step${index}`,
        reportId,
        smtpAccount,
      }).catch(err => {
        console.error(`[sender] Step ${index} failed for ${reportId}: ${err.message}`)
      })
    }, delayMs)

    handles.push(handle)
    scheduledSteps.push({
      step:      step.step,
      scheduledAt,
      provider:  smtpAccount?.provider || "unconfigured",
      smtpUser:  smtpAccount?.user     || null,
    })
  })

  scheduledSequences.set(reportId, handles)

  return { scheduled: true, reportId, steps: scheduledSteps }
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export function cancelScheduledSequence(reportId) {
  const handles = scheduledSequences.get(reportId)
  if (handles) {
    handles.forEach(h => clearTimeout(h))
    scheduledSequences.delete(reportId)
  }
  return { cancelled: true, reportId }
}
