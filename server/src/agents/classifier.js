// Agent 3A — Reply Classifier
// Model: gpt-4o-mini via OpenAI API (raw fetch, no SDK)

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
const MODEL = "gpt-4o-mini"
const MAX_TOKENS = 200
const TIMEOUT_MS = 10_000

const SYSTEM_PROMPT =
  "You are an email reply classifier for a cold outreach platform. Classify inbound replies into exactly one category: " +
  "INTERESTED (wants to learn more, asked a question, positive interest, said yes), " +
  "NOT_NOW (not interested right now, timing issue), " +
  "WRONG_PERSON (not the right contact), " +
  "UNSUBSCRIBE (wants to be removed — any variation, be conservative), " +
  "OUT_OF_OFFICE (automated OOO reply), " +
  "OBJECTION (specific addressable concern about cost, vendor, or value — not a flat no), " +
  "NOT_INTERESTED (flat rejection, no opening). " +
  "Rules: when in doubt between INTERESTED and NOT_NOW choose NOT_NOW; " +
  "when in doubt between NOT_INTERESTED and UNSUBSCRIBE choose UNSUBSCRIBE; " +
  "OBJECTION requires a specific addressable concern. Return ONLY valid JSON."

const FALLBACK = {
  classification: "NOT_INTERESTED",
  confidence: "low",
  key_signal: "classification_failed",
  return_date: null,
  also_unsubscribe: false,
}

/**
 * Classify an inbound email reply against the original outreach.
 *
 * @param {string} originalSubject
 * @param {string} originalBody
 * @param {string} replyBody
 * @returns {Promise<{
 *   classification: string,
 *   confidence: string,
 *   key_signal: string,
 *   return_date: string|null,
 *   also_unsubscribe: boolean
 * }>}
 */
export async function classifyReply(originalSubject, originalBody, replyBody) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured")
  }

  const userPrompt =
    `Original email subject: ${originalSubject}\n` +
    `Original email body: ${originalBody}\n\n` +
    `Inbound reply:\n${replyBody}\n\n` +
    `Classify this reply and return JSON: ` +
    `{"classification": "", "confidence": "high", "key_signal": "", "return_date": null, "also_unsubscribe": false}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`OpenAI API error ${response.status}: ${text}`)
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content

    if (!content) {
      throw new Error("Empty response from OpenAI")
    }

    const parsed = JSON.parse(content)
    return {
      classification: parsed.classification ?? FALLBACK.classification,
      confidence: parsed.confidence ?? FALLBACK.confidence,
      key_signal: parsed.key_signal ?? FALLBACK.key_signal,
      return_date: parsed.return_date ?? null,
      also_unsubscribe: parsed.also_unsubscribe ?? false,
    }
  } catch (err) {
    // Surface timeout and config errors as-is; swallow classification failures
    if (err.name === "AbortError") {
      return { ...FALLBACK, key_signal: "classification_timeout" }
    }
    if (err.message === "OPENAI_API_KEY not configured") {
      throw err
    }
    return { ...FALLBACK }
  } finally {
    clearTimeout(timer)
  }
}
