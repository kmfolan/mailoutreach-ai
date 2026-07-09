/**
 * Prospect Research Agent
 * Model: GPT-4o mini via OpenAI API (raw fetch, no SDK)
 */

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
const MODEL = "gpt-4o-mini"
const MAX_TOKENS = 800
const TIMEOUT_MS = 15_000

const SYSTEM_PROMPT =
  "You are a business intelligence analyst specializing in SMB and local business research. " +
  "Analyze website content and build a structured prospect profile for cold outreach. " +
  "Identify: what the business sells and who they serve, homepage CTA quality, trust signals present " +
  "or missing (testimonials, case studies, reviews, certifications, before/after examples), SEO signals " +
  "(title tag, meta description, h1 quality), the single biggest gap or weakness visible from the public " +
  "website, 2-3 specific personalization hooks — real concrete details that prove the sender looked at " +
  "this business. Rules: be specific and factual, only reference things actually present or absent in the " +
  "content, do not invent details. Return ONLY valid JSON."

/**
 * Build the user prompt from snapshot and campaign context.
 *
 * @param {Object} snapshot
 * @param {Object} campaignContext
 * @returns {string}
 */
function buildUserPrompt(snapshot, campaignContext) {
  const {
    url = "",
    title = "",
    description = "",
    h1 = "",
    bodySample = "",
    callToActionSignals = [],
    trustSignals = [],
    notes = "",
  } = snapshot

  const {
    companyName = "",
    location = "",
    cta = "",
    auditMode = "",
    painPoints = [],
  } = campaignContext

  const painPointsList = Array.isArray(painPoints)
    ? painPoints.join(", ")
    : painPoints

  const ctaSignalsList = Array.isArray(callToActionSignals)
    ? callToActionSignals.join(", ")
    : callToActionSignals

  const trustSignalsList = Array.isArray(trustSignals)
    ? trustSignals.join(", ")
    : trustSignals

  return `Analyze this business website and return a structured prospect profile as valid JSON.

Website snapshot:
- URL: ${url}
- Title tag: ${title}
- Meta description: ${description}
- H1: ${h1}
- Body sample: ${bodySample}
- CTA signals found: ${ctaSignalsList || "none detected"}
- Trust signals found: ${trustSignalsList || "none detected"}
- Notes: ${notes || "none"}

Campaign context:
- Company name: ${companyName}
- Location: ${location}
- Our CTA / offer: ${cta}
- Audit mode: ${auditMode}
- Pain points we address: ${painPointsList || "none specified"}

Return ONLY a valid JSON object with exactly these fields:
{
  "company_name": "string",
  "website_url": "string",
  "location": "string",
  "primary_offer": "string — what this business sells and to whom",
  "target_audience": "string — who their customers are",
  "homepage_cta": {
    "present": true | false,
    "text": "string — exact CTA text if present, empty string if absent",
    "quality": "strong" | "weak" | "missing"
  },
  "trust_signals": {
    "present": ["array of trust signals found on the page"],
    "missing": ["array of common trust signals not found"]
  },
  "meta_description": {
    "present": true | false,
    "quality": "string — brief assessment",
    "text": "string — the actual meta description or empty string"
  },
  "h1": "string — the h1 text",
  "top_gap": "string — the single biggest weakness or missed opportunity visible from the public site",
  "personalization_hooks": [
    "string — specific, concrete detail #1 from the site",
    "string — specific, concrete detail #2 from the site",
    "string — specific, concrete detail #3 from the site"
  ],
  "outreach_angle": "string — the most compelling angle for a cold outreach email given their gaps and our offer"
}`
}

/**
 * Build a fallback prospect profile when the API call or JSON parsing fails.
 *
 * @param {Object} snapshot
 * @param {Object} campaignContext
 * @returns {Object}
 */
function buildFallback(snapshot, campaignContext) {
  return {
    company_name: campaignContext.companyName || snapshot.url || "Unknown",
    website_url: snapshot.url || "",
    location: campaignContext.location || "",
    primary_offer: "",
    target_audience: "",
    homepage_cta: {
      present: Array.isArray(snapshot.callToActionSignals)
        ? snapshot.callToActionSignals.length > 0
        : false,
      text:
        Array.isArray(snapshot.callToActionSignals) &&
        snapshot.callToActionSignals.length > 0
          ? snapshot.callToActionSignals[0]
          : "",
      quality: "missing",
    },
    trust_signals: {
      present: Array.isArray(snapshot.trustSignals) ? snapshot.trustSignals : [],
      missing: [],
    },
    meta_description: {
      present: Boolean(snapshot.description),
      quality: snapshot.description ? "present but unassessed" : "missing",
      text: snapshot.description || "",
    },
    h1: snapshot.h1 || "",
    top_gap: "Unable to assess — research agent unavailable",
    personalization_hooks: [
      snapshot.title ? `Title tag: "${snapshot.title}"` : "Title tag not available",
      snapshot.h1 ? `H1: "${snapshot.h1}"` : "H1 not available",
      snapshot.description
        ? `Meta description present`
        : "Missing meta description",
    ],
    outreach_angle: campaignContext.cta || "",
    fallback_used: true,
  }
}

/**
 * Research a prospect using GPT-4o mini via the OpenAI API.
 *
 * @param {Object} snapshot - { url, title, description, h1, bodySample, callToActionSignals, trustSignals, notes }
 * @param {Object} campaignContext - { companyName, location, cta, auditMode, painPoints }
 * @returns {Promise<Object>} prospectProfile
 */
export async function researchProspect(snapshot, campaignContext) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured")
  }

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
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(snapshot, campaignContext) },
        ],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "(no body)")
      console.error(
        `[research] OpenAI API error ${response.status}: ${errorText}`
      )
      return buildFallback(snapshot, campaignContext)
    }

    const data = await response.json()
    const raw = data?.choices?.[0]?.message?.content ?? ""

    try {
      // Strip markdown code fences if the model wrapped the JSON
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()
      return JSON.parse(cleaned)
    } catch (parseErr) {
      console.error("[research] Failed to parse OpenAI response as JSON:", parseErr.message)
      console.error("[research] Raw content:", raw.slice(0, 300))
      return buildFallback(snapshot, campaignContext)
    }
  } catch (fetchErr) {
    if (fetchErr.name === "AbortError") {
      console.error("[research] OpenAI request timed out after", TIMEOUT_MS, "ms")
    } else {
      console.error("[research] Fetch error:", fetchErr.message)
    }
    return buildFallback(snapshot, campaignContext)
  } finally {
    clearTimeout(timer)
  }
}
