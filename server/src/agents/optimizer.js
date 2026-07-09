// Agent 4 — Campaign Optimization Agent
// Model: gpt-4o via OpenAI API (raw fetch, no SDK)

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
const MODEL = "gpt-4o"
const MAX_TOKENS = 1000
const TIMEOUT_MS = 30_000

const SYSTEM_PROMPT =
  "You are a cold email campaign analyst. Review performance data and identify what is working, " +
  "what is not, and exactly what to change. Quote actual numbers. " +
  "Benchmarks: open rate 30-50%, reply rate 5-15%, positive reply rate 2-5%. " +
  "If something performs well say so. " +
  "Output is a brief scannable report an operator reads in 2 minutes. " +
  "Prioritize action over analysis. Return ONLY valid JSON."

const FALLBACK = {
  overall_health: "unknown",
  operator_summary: "Optimization analysis failed — check API key and try again.",
  priority_action_this_week: "Manual review required.",
}

/**
 * Format the campaign data into a clear user prompt for the model.
 *
 * @param {object} campaignData
 * @returns {string}
 */
function buildUserPrompt(campaignData) {
  const {
    campaignName,
    niche,
    location,
    cta,
    dateRange,
    totalProspects,
    emailStats,
    replyClassifications,
    topObjections,
    subjectLinePerformance,
    hotLeads,
  } = campaignData

  const emailStatsText = Array.isArray(emailStats)
    ? emailStats
        .map((s) => `  Step ${s.step}: ${s.sent} sent, ${s.opens} opens, ${s.replies} replies`)
        .join("\n")
    : "  (none)"

  const classText = replyClassifications
    ? Object.entries(replyClassifications)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n")
    : "  (none)"

  const objectionsText = Array.isArray(topObjections) && topObjections.length
    ? topObjections.map((o) => `  - ${o}`).join("\n")
    : "  (none)"

  const subjectText = Array.isArray(subjectLinePerformance)
    ? subjectLinePerformance
        .map((s) => `  "${s.subject}" — ${s.sends} sends, ${(s.openRate * 100).toFixed(1)}% open rate`)
        .join("\n")
    : "  (none)"

  const hotLeadsText = Array.isArray(hotLeads)
    ? hotLeads
        .map((l) => `  ${l.companyName} (${l.websiteUrl}) — ${l.openCount} opens`)
        .join("\n")
    : "  (none)"

  return (
    `Campaign: ${campaignName}\n` +
    `Niche: ${niche}\n` +
    `Location: ${location}\n` +
    `CTA: ${cta}\n` +
    `Date range: ${dateRange}\n` +
    `Total prospects: ${totalProspects}\n\n` +
    `Email sequence performance:\n${emailStatsText}\n\n` +
    `Reply classifications:\n${classText}\n\n` +
    `Top objections raised:\n${objectionsText}\n\n` +
    `Subject line performance:\n${subjectText}\n\n` +
    `Hot leads (multiple opens, no reply):\n${hotLeadsText}\n\n` +
    `Analyze this campaign and return JSON:\n` +
    `{\n` +
    `  "overall_health": "<strong | average | weak>",\n` +
    `  "open_rate_summary": "<one sentence with numbers vs benchmark>",\n` +
    `  "reply_rate_summary": "<one sentence with numbers vs benchmark>",\n` +
    `  "best_performing_subject_pattern": "<pattern or exact line that worked>",\n` +
    `  "worst_performing_subject_pattern": "<pattern or exact line that underperformed>",\n` +
    `  "best_performing_email_step": "<step number and why>",\n` +
    `  "objection_pattern": "<what objections cluster around, or 'none'>",\n` +
    `  "objection_reframe_suggestion": "<specific language to try in sequence>",\n` +
    `  "hot_leads_count": <number>,\n` +
    `  "hot_leads_recommended_action": "<exact next step for hot leads>",\n` +
    `  "sequence_change_recommendation": "<one concrete change to copy, timing, or structure>",\n` +
    `  "priority_action_this_week": "<single most impactful action>",\n` +
    `  "operator_summary": "<2-3 sentences for a non-analyst — what happened, what matters, what to do>"\n` +
    `}`
  )
}

/**
 * Run campaign optimization analysis and return a structured report.
 *
 * @param {{
 *   campaignName: string,
 *   niche: string,
 *   location: string,
 *   cta: string,
 *   dateRange: string,
 *   totalProspects: number,
 *   emailStats: Array<{step: number, sent: number, opens: number, replies: number}>,
 *   replyClassifications: Record<string, number>,
 *   topObjections: string[],
 *   subjectLinePerformance: Array<{subject: string, sends: number, openRate: number}>,
 *   hotLeads: Array<{companyName: string, websiteUrl: string, openCount: number}>
 * }} campaignData
 * @returns {Promise<{
 *   overall_health: string,
 *   open_rate_summary: string,
 *   reply_rate_summary: string,
 *   best_performing_subject_pattern: string,
 *   worst_performing_subject_pattern: string,
 *   best_performing_email_step: string,
 *   objection_pattern: string,
 *   objection_reframe_suggestion: string,
 *   hot_leads_count: number,
 *   hot_leads_recommended_action: string,
 *   sequence_change_recommendation: string,
 *   priority_action_this_week: string,
 *   operator_summary: string
 * }>}
 */
export async function optimizeCampaign(campaignData) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured")
  }

  const userPrompt = buildUserPrompt(campaignData)

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
      overall_health: parsed.overall_health ?? "unknown",
      open_rate_summary: parsed.open_rate_summary ?? "",
      reply_rate_summary: parsed.reply_rate_summary ?? "",
      best_performing_subject_pattern: parsed.best_performing_subject_pattern ?? "",
      worst_performing_subject_pattern: parsed.worst_performing_subject_pattern ?? "",
      best_performing_email_step: parsed.best_performing_email_step ?? "",
      objection_pattern: parsed.objection_pattern ?? "",
      objection_reframe_suggestion: parsed.objection_reframe_suggestion ?? "",
      hot_leads_count: typeof parsed.hot_leads_count === "number" ? parsed.hot_leads_count : 0,
      hot_leads_recommended_action: parsed.hot_leads_recommended_action ?? "",
      sequence_change_recommendation: parsed.sequence_change_recommendation ?? "",
      priority_action_this_week: parsed.priority_action_this_week ?? FALLBACK.priority_action_this_week,
      operator_summary: parsed.operator_summary ?? FALLBACK.operator_summary,
    }
  } catch (err) {
    if (err.message === "OPENAI_API_KEY not configured") {
      throw err
    }
    return { ...FALLBACK }
  } finally {
    clearTimeout(timer)
  }
}
