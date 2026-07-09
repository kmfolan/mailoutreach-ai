/**
 * Personalized Email Writer Agent
 * Model: claude-sonnet-4-5 via Anthropic API (raw fetch, no SDK)
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
const MODEL = "claude-sonnet-4-5"
const MAX_TOKENS = 1500
const TIMEOUT_MS = 30_000
const ANTHROPIC_VERSION = "2023-06-01"
const ANTHROPIC_BETA = "prompt-caching-2024-07-31"

const SYSTEM_PROMPT =
  "You are a cold email copywriter who writes personalized, high-converting outreach sequences. " +
  "TONE: Conversational and direct, like a smart person who did their homework. Never formal. " +
  "BANNED PHRASES: 'I hope this email finds you well', 'I wanted to reach out', 'touching base', " +
  "'circling back', 'following up', 'just checking in', 'synergies', 'leverage', " +
  "'Would you be open to a quick 15-minute call?', 'I noticed your company' (too generic). " +
  "LENGTH: Email 1: 90-130 words max. Email 2: 70-100 words max. Email 3: 50-75 words max. " +
  "SUBJECT LINES: Under 7 words, lowercase preferred, no clickbait. " +
  "CTA: One per email. Email 1: tease the audit — offer to send it or ask if they want to see it. " +
  "Email 2: include the audit URL directly (use the auditPageUrl from the brief). " +
  "Email 3: soft close referencing the unseen audit. " +
  "AUDIT HOOK: When seoAudit data is provided, Email 1 must reference a specific SEO finding " +
  "(keyword count, traffic number, or position) to prove you actually looked at their site. " +
  "SPECIFICITY: Email 1 must reference at least one specific personalization hook."

/**
 * Build the cached system + campaign brief text block.
 *
 * @param {Object} campaignBrief
 * @returns {string}
 */
function buildCachedBlock(campaignBrief) {
  const {
    cta = "",
    auditMode = "",
    painPoints = [],
    reportRequirements = [],
    location = "",
    companyName = "",
    auditPageUrl = "",
    seoAudit = null,
  } = campaignBrief

  const painPointsList = Array.isArray(painPoints)
    ? painPoints.join(", ")
    : painPoints

  const requirementsList = Array.isArray(reportRequirements)
    ? reportRequirements.join(", ")
    : reportRequirements

  let seoBlock = ""
  if (seoAudit && !seoAudit.fallback_used) {
    const kwLines = seoAudit.topKeywords.slice(0, 3).map(
      k => `  • "${k.keyword}" → position ${k.position} (${(k.searchVolume || 0).toLocaleString()} searches/mo)`
    ).join("\n")
    seoBlock =
      `\nSEO audit data (use these specific numbers in email 1):\n` +
      `- Organic keywords ranking: ${seoAudit.organicKeywords ?? "unknown"}\n` +
      `- Estimated monthly traffic: ${seoAudit.monthlyTraffic ?? "unknown"}\n` +
      `- Biggest gap: ${seoAudit.biggestGap}\n` +
      (kwLines ? `- Top keyword positions:\n${kwLines}\n` : "")
  }

  const auditBlock = auditPageUrl
    ? `\nAudit page URL (use this in email 2's body as the CTA link): ${auditPageUrl}\n`
    : ""

  return (
    SYSTEM_PROMPT +
    `\n\nCampaign brief:\n` +
    `- CTA: ${cta}\n` +
    `- Audit mode: ${auditMode}\n` +
    `- Pain points: ${painPointsList || "none specified"}\n` +
    `- Positioning: ${requirementsList || "none specified"}\n` +
    `- Market: ${location}` +
    (companyName ? `\n- Sender company: ${companyName}` : "") +
    seoBlock +
    auditBlock
  )
}

/**
 * Build a 3-email fallback sequence when the API call or JSON parsing fails.
 *
 * @param {Object} prospectProfile
 * @param {Object} campaignBrief
 * @returns {Array<{step: number, subject: string, body: string}>}
 */
function buildFallback(prospectProfile, campaignBrief) {
  const companyName = prospectProfile.company_name || prospectProfile.website_url || "your business"
  const gap = prospectProfile.top_gap || "potential growth opportunity"
  const angle = prospectProfile.outreach_angle || campaignBrief.cta || "our services"
  const hook =
    Array.isArray(prospectProfile.personalization_hooks) &&
    prospectProfile.personalization_hooks.length > 0
      ? prospectProfile.personalization_hooks[0]
      : ""

  return [
    {
      step: 1,
      subject: `quick question for ${companyName}`,
      body:
        `Hi,\n\n` +
        (hook ? `Took a look at ${companyName} — ${hook}.\n\n` : `Checked out ${companyName} recently.\n\n`) +
        `One thing stood out: ${gap}.\n\n` +
        `We work with businesses like yours on ${angle}. ` +
        `Worth a quick look?\n\n` +
        `Mind if I send over a short breakdown of what we'd do differently for you?`,
    },
    {
      step: 2,
      subject: `re: ${companyName}`,
      body:
        `Hey,\n\n` +
        `Sent a note last week about ${gap}.\n\n` +
        `Happy to put together a short audit showing exactly what we'd fix and why it matters. ` +
        `No commitment — just something concrete you can look at.\n\n` +
        `Want me to send it over?`,
    },
    {
      step: 3,
      subject: `last note`,
      body:
        `Hi,\n\n` +
        `I'll keep this brief — if ${gap} is something on your radar, ` +
        `I'm happy to share what we'd recommend.\n\n` +
        `If timing's off, no worries at all. ` +
        `Either way, best of luck with things.`,
    },
  ]
}

/**
 * Write a 3-email cold outreach sequence using Claude via the Anthropic API.
 *
 * @param {Object} prospectProfile - object returned by researchProspect()
 * @param {Object} campaignBrief - { cta, auditMode, painPoints, reportRequirements, location, companyName }
 * @returns {Promise<Array<{step: number, subject: string, body: string}>>}
 */
export async function writeEmailSequence(prospectProfile, campaignBrief) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured")
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": ANTHROPIC_BETA,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: buildCachedBlock(campaignBrief),
                cache_control: { type: "ephemeral" },
              },
              {
                type: "text",
                text:
                  "Prospect profile:\n" +
                  JSON.stringify(prospectProfile, null, 2) +
                  '\n\nWrite a 3-email cold outreach sequence. Return ONLY a valid JSON array: ' +
                  '[{"step":1,"subject":"","body":""},{"step":2,"subject":"","body":""},{"step":3,"subject":"","body":""}]',
              },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "(no body)")
      console.error(
        `[emailWriter] Anthropic API error ${response.status}: ${errorText}`
      )
      return buildFallback(prospectProfile, campaignBrief)
    }

    const data = await response.json()
    const raw = data?.content?.[0]?.text ?? ""

    try {
      // Strip markdown code fences if the model wrapped the JSON
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()
      const parsed = JSON.parse(cleaned)

      if (!Array.isArray(parsed) || parsed.length !== 3) {
        throw new Error("Response is not a 3-element array")
      }

      return parsed.map((item, idx) => ({
        step: item.step ?? idx + 1,
        subject: item.subject ?? "",
        body: item.body ?? "",
      }))
    } catch (parseErr) {
      console.error("[emailWriter] Failed to parse Anthropic response as JSON:", parseErr.message)
      console.error("[emailWriter] Raw content:", raw.slice(0, 300))
      return buildFallback(prospectProfile, campaignBrief)
    }
  } catch (fetchErr) {
    if (fetchErr.name === "AbortError") {
      console.error("[emailWriter] Anthropic request timed out after", TIMEOUT_MS, "ms")
    } else {
      console.error("[emailWriter] Fetch error:", fetchErr.message)
    }
    return buildFallback(prospectProfile, campaignBrief)
  } finally {
    clearTimeout(timer)
  }
}
