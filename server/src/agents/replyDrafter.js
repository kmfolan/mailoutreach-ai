// Agent 3B — Reply Drafter
// Model: claude-sonnet-4-5 via Anthropic API (raw fetch, no SDK) with prompt caching

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
const MODEL = "claude-sonnet-4-5"
const MAX_TOKENS = 600
const TIMEOUT_MS = 20_000

// Cached system prompt — same for every call, so Anthropic can cache it across requests.
const SYSTEM_PROMPT =
  "You are a cold outreach reply specialist who writes concise, human, non-pushy responses. " +
  "Match the energy of the inbound message. Most replies: 3-6 sentences, never more than 100 words unless truly needed. " +
  "Never open with 'Great!', 'Absolutely!', 'Thanks for getting back to me!'. " +
  "Reference what they actually said. Don't oversell. Leave the relationship intact even on negatives. " +
  "INTERESTED: confirm next step simply, provide calendar link or offer to send report, under 60 words. " +
  "NOT_NOW: acknowledge timing without guilt, name specific re-contact timeframe, under 50 words. " +
  "WRONG_PERSON: thank them, ask for right person's name/email, one clear ask, under 40 words. " +
  "UNSUBSCRIBE: one sentence only: 'Got it — removing you now. Sorry for the interruption.' " +
  "OUT_OF_OFFICE: return empty body with scheduled_followup_date, auto_send: true. " +
  "OBJECTION (vendor): acknowledge, plant seed about second opinion, one soft question, under 70 words. " +
  "OBJECTION (cost): don't defend price, reframe around ROI, offer to show specific issue first, under 70 words. " +
  "NOT_INTERESTED: 'Understood — thanks for letting me know. I'll leave it there.' " +
  "Return ONLY valid JSON."

/**
 * Build sensible fallback reply for a given classification type.
 *
 * @param {string} classification
 * @param {string} originalSubject
 * @returns {{subject: string, body: string, scheduled_followup_date: string|null, auto_send: boolean, internal_note: string}}
 */
function buildFallback(classification, originalSubject) {
  const subject = `Re: ${originalSubject}`

  const defaults = {
    INTERESTED: {
      body: "Thanks for your reply — happy to share more. What time works best for a quick call?",
      scheduled_followup_date: null,
      auto_send: false,
      internal_note: "Fallback draft — review before sending.",
    },
    NOT_NOW: {
      body: "Completely understand — I'll follow up in a few weeks when timing might be better.",
      scheduled_followup_date: null,
      auto_send: false,
      internal_note: "Fallback draft — set a follow-up reminder.",
    },
    WRONG_PERSON: {
      body: "Thanks for letting me know — could you point me to the right person to speak with?",
      scheduled_followup_date: null,
      auto_send: false,
      internal_note: "Fallback draft — get correct contact before sending.",
    },
    UNSUBSCRIBE: {
      body: "Got it — removing you now. Sorry for the interruption.",
      scheduled_followup_date: null,
      auto_send: true,
      internal_note: "Auto-send: unsubscribe confirmed.",
    },
    OUT_OF_OFFICE: {
      body: "",
      scheduled_followup_date: null,
      auto_send: true,
      internal_note: "OOO detected — will retry when they return.",
    },
    OBJECTION: {
      body: "Fair point — worth a quick look to see if the numbers make sense before committing to anything. Would that be useful?",
      scheduled_followup_date: null,
      auto_send: false,
      internal_note: "Fallback draft — tailor objection reframe before sending.",
    },
    NOT_INTERESTED: {
      body: "Understood — thanks for letting me know. I'll leave it there.",
      scheduled_followup_date: null,
      auto_send: false,
      internal_note: "Flat rejection — archive this prospect.",
    },
  }

  const specific = defaults[classification] ?? {
    body: "Thanks for your reply — I'll be in touch.",
    scheduled_followup_date: null,
    auto_send: false,
    internal_note: "Fallback draft — classification unknown.",
  }

  return { subject, ...specific }
}

/**
 * Draft a reply to an inbound cold outreach response.
 *
 * @param {string} classification — output from classifyReply
 * @param {{ companyName: string, location: string, cta: string, topGap: string, outreachAngle: string }} prospectContext
 * @param {{ subject: string, body: string }} originalEmail
 * @param {string} replyBody
 * @returns {Promise<{
 *   subject: string,
 *   body: string,
 *   scheduled_followup_date: string|null,
 *   auto_send: boolean,
 *   internal_note: string
 * }>}
 */
export async function draftReply(classification, prospectContext, originalEmail, replyBody) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured")
  }

  const userPrompt =
    `Classification: ${classification}\n\n` +
    `Prospect context:\n` +
    `  Company: ${prospectContext.companyName}\n` +
    `  Location: ${prospectContext.location}\n` +
    `  CTA: ${prospectContext.cta}\n` +
    `  Top gap identified: ${prospectContext.topGap}\n` +
    `  Outreach angle: ${prospectContext.outreachAngle}\n\n` +
    `Original email sent:\n` +
    `  Subject: ${originalEmail.subject}\n` +
    `  Body: ${originalEmail.body}\n\n` +
    `Inbound reply received:\n${replyBody}\n\n` +
    `Draft the reply and return JSON:\n` +
    `{\n` +
    `  "subject": "Re: <original subject>",\n` +
    `  "body": "<reply body — follow word-count rules from your instructions>",\n` +
    `  "scheduled_followup_date": "<ISO date string or null>",\n` +
    `  "auto_send": <true only for UNSUBSCRIBE and OUT_OF_OFFICE>,\n` +
    `  "internal_note": "<brief CRM note — what happened, what to do next>"\n` +
    `}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          { role: "user", content: userPrompt },
        ],
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Anthropic API error ${response.status}: ${text}`)
    }

    const data = await response.json()
    const text = data?.content?.[0]?.text

    if (!text) {
      throw new Error("Empty response from Anthropic")
    }

    const parsed = JSON.parse(text)
    return {
      subject: parsed.subject ?? `Re: ${originalEmail.subject}`,
      body: parsed.body ?? "",
      scheduled_followup_date: parsed.scheduled_followup_date ?? null,
      auto_send: parsed.auto_send === true,
      internal_note: parsed.internal_note ?? "",
    }
  } catch (err) {
    if (err.message === "ANTHROPIC_API_KEY not configured") {
      throw err
    }
    // Fallback: return a sensible default for the classification type
    return buildFallback(classification, originalEmail.subject ?? "")
  } finally {
    clearTimeout(timer)
  }
}
