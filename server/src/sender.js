/**
 * sender.js — Email sending layer
 *
 * Provides the full interface for scheduling and sending outreach sequences.
 * SMTP sending is stubbed today (no npm deps) — the TODO comments explain
 * exactly how to wire up nodemailer once it is installed.
 *
 * Dependencies: Node.js built-ins only. No npm deps.
 */

// ---------------------------------------------------------------------------
// Open/click tracking helpers
// ---------------------------------------------------------------------------

export function buildOpenTrackingPixel(trackingId) {
  const host = process.env.TRACKING_HOST || "localhost:4020"
  return (
    `<img src="http://${host}/track/open/${trackingId}" ` +
    `width="1" height="1" style="display:none" alt="">`
  )
}

export function buildTrackedLink(url, trackingId) {
  const host = process.env.TRACKING_HOST || "localhost:4020"
  return `http://${host}/track/click/${trackingId}?url=${encodeURIComponent(url)}`
}

// ---------------------------------------------------------------------------
// Core send function (SMTP stub)
// ---------------------------------------------------------------------------

export async function sendEmail({ to, subject, body, from, replyTo, trackingId, reportId }) {
  const smtpUser = process.env.SMTP_USER
  const smtpPass = process.env.SMTP_PASS

  if (!smtpUser || !smtpPass) {
    console.log(`📧 [SMTP NOT CONFIGURED] Would send to: ${to} | Subject: ${subject}`)
    return {
      sent: false,
      reason: "smtp_not_configured",
      queued: true,
      to,
      subject
    }
  }

  // TODO: implement sending with nodemailer once installed.
  //
  // Installation:
  //   cd server && npm install nodemailer
  //
  // Then replace this block with:
  //
  //   import nodemailer from "nodemailer"
  //
  //   const transporter = nodemailer.createTransport({
  //     host: process.env.SMTP_HOST || "smtp.gmail.com",
  //     port: Number(process.env.SMTP_PORT) || 587,
  //     secure: process.env.SMTP_SECURE === "true",
  //     auth: { user: smtpUser, pass: smtpPass }
  //   })
  //
  //   const htmlBody = body + buildOpenTrackingPixel(trackingId)
  //
  //   const info = await transporter.sendMail({
  //     from: from || `"MailOutreach" <${smtpUser}>`,
  //     to,
  //     replyTo: replyTo || from || smtpUser,
  //     subject,
  //     text: body,
  //     html: htmlBody
  //   })
  //
  //   return { sent: true, messageId: info.messageId, to, subject }

  console.log(
    `📧 [NODEMAILER PENDING] Install nodemailer to enable sending: cd server && npm install nodemailer`
  )
  return {
    sent: false,
    reason: "nodemailer_not_installed",
    queued: true,
    to,
    subject
  }
}

// ---------------------------------------------------------------------------
// Sequence scheduler
// ---------------------------------------------------------------------------

/**
 * Tracks pending timer handles indexed by reportId.
 * Each value is an array of timer IDs (one per sequence step).
 *
 * @type {Map<string, ReturnType<typeof setTimeout>[]>}
 */
export const scheduledSequences = new Map()

/**
 * Schedule a 3-step outreach sequence for a given report.
 *
 * @param {string} reportId
 * @param {Array<{step: number|string, subject: string, body: string}>} sequence
 * @param {{ from?: string, replyTo?: string, toEmail: string, toName?: string, delayDays?: number[] }} sendConfig
 *
 * TODO: replace setTimeout with a persistent job queue (e.g. BullMQ, pg-boss,
 * or a simple cron-backed table in db.json) before going to production.
 * In-memory timers are lost on server restart.
 */
export async function scheduleSequence(reportId, sequence, sendConfig) {
  // Cancel any existing sequence for this report first
  cancelScheduledSequence(reportId)

  const { from, replyTo, toEmail, toName, delayDays = [0, 3, 7] } = sendConfig
  const steps = sequence.slice(0, 3)
  const handles = []
  const scheduledSteps = []

  steps.forEach((step, index) => {
    const daysDelay = delayDays[index] !== undefined ? delayDays[index] : index * 3
    // Day-0 emails use a tiny delay so the function can return before the
    // callback fires (allows the caller to store the returned metadata first).
    const delayMs = daysDelay === 0 ? 500 : daysDelay * 24 * 60 * 60 * 1000
    const scheduledAt = new Date(Date.now() + delayMs).toISOString()

    const handle = setTimeout(() => {
      sendEmail({
        to: toEmail,
        subject: step.subject,
        body: step.body,
        from,
        replyTo,
        trackingId: `${reportId}_step${index}`,
        reportId
      }).catch(error => {
        console.error(`[sender] Failed to send step ${index} for report ${reportId}:`, error.message)
      })
    }, delayMs)

    handles.push(handle)
    scheduledSteps.push({ step: step.step, scheduledAt })
  })

  scheduledSequences.set(reportId, handles)

  return {
    scheduled: true,
    reportId,
    steps: scheduledSteps
  }
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export function cancelScheduledSequence(reportId) {
  const handles = scheduledSequences.get(reportId)
  if (handles) {
    handles.forEach(handle => clearTimeout(handle))
    scheduledSequences.delete(reportId)
  }
  return { cancelled: true, reportId }
}
