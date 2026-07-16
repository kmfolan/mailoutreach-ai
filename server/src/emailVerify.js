/**
 * emailVerify.js — email verification (Layer 4 of the lead-gen waterfall)
 *
 * Two levels, cheapest first:
 *   syntax  — RFC-ish shape check
 *   MX      — does the domain actually run mail servers? (DNS, free, reliable)
 *   SMTP    — mailbox RCPT probe (opt-in; unreliable at scale — see note)
 *
 * MX-level verification is the sane default for a bulk cold list: it removes
 * dead domains (the ones that hurt sender reputation) without the flakiness of
 * SMTP probing. SMTP is opt-in because many ISPs block outbound port 25 and
 * catch-all / greylisting domains return ambiguous results.
 *
 * Dependencies: Node.js built-ins only (dns/promises, net).
 */

import { resolveMx } from "node:dns/promises"
import net from "node:net"

const SYNTAX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const mxCache = new Map()

export function isValidSyntax(email) {
  return SYNTAX.test(String(email || "").trim().toLowerCase())
}

// Returns { ok, host } for a domain, cached so repeated domains cost one lookup.
export async function lookupMx(domain) {
  if (mxCache.has(domain)) {
    return mxCache.get(domain)
  }
  let result = { ok: false, host: null }
  try {
    const records = await resolveMx(domain)
    if (records && records.length > 0) {
      records.sort((a, b) => a.priority - b.priority)
      result = { ok: true, host: records[0].exchange }
    }
  } catch {
    // NXDOMAIN / no MX → ok:false
  }
  mxCache.set(domain, result)
  return result
}

function smtpProbe(mxHost, email, from) {
  return new Promise(resolve => {
    const socket = net.createConnection(25, mxHost)
    let stage = 0
    let settled = false
    const done = verdict => {
      if (settled) {
        return
      }
      settled = true
      try {
        socket.write("QUIT\r\n")
        socket.end()
      } catch {
        // socket already gone
      }
      resolve(verdict)
    }
    const heloDomain = String(from).split("@")[1] || "example.com"
    socket.setTimeout(8000, () => done("smtp-unknown"))
    socket.on("error", () => done("smtp-unknown"))
    socket.on("data", buf => {
      const code = parseInt(buf.toString().slice(0, 3), 10)
      if (stage === 0) {
        socket.write(`HELO ${heloDomain}\r\n`)
        stage = 1
      } else if (stage === 1) {
        socket.write(`MAIL FROM:<${from}>\r\n`)
        stage = 2
      } else if (stage === 2) {
        socket.write(`RCPT TO:<${email}>\r\n`)
        stage = 3
      } else if (stage === 3) {
        if (code >= 200 && code < 300) {
          done("smtp-ok")
        } else if (code === 550 || code === 551 || code === 553) {
          done("smtp-rejected")
        } else {
          done("smtp-unknown")
        }
      }
    })
  })
}

/**
 * Verify a single email.
 * @returns {Promise<{email:string, status:string, ok:boolean}>}
 *   status ∈ invalid-syntax | no-mx | valid-mx | smtp-ok | smtp-rejected | smtp-unknown
 *   ok is false only for definitively-bad results (invalid-syntax, no-mx,
 *   smtp-rejected); ambiguous SMTP results keep the email (ok:true).
 */
export async function verifyEmail(email, options = {}) {
  const { smtp = false, from = "verify@example.com" } = options
  const value = String(email || "").trim().toLowerCase()

  if (!isValidSyntax(value)) {
    return { email: value, status: "invalid-syntax", ok: false }
  }

  const domain = value.split("@")[1]
  const mx = await lookupMx(domain)
  if (!mx.ok) {
    return { email: value, status: "no-mx", ok: false }
  }

  if (smtp) {
    const verdict = await smtpProbe(mx.host, value, from)
    return { email: value, status: verdict, ok: verdict !== "smtp-rejected" }
  }

  return { email: value, status: "valid-mx", ok: true }
}
