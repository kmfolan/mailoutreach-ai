/**
 * SEO Audit Agent — DataForSEO integration
 * Pulls real domain organic metrics and keyword rankings per prospect.
 * Used as the "free audit" hook in outreach emails.
 */

import https from "https"

const TIMEOUT_MS = 15_000

function makeAuthHeader() {
  const login = process.env.DATAFORSEO_LOGIN || ""
  const password = process.env.DATAFORSEO_PASSWORD || ""
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64")
}

function dfsPost(apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const options = {
      hostname: "api.dataforseo.com",
      path: apiPath,
      method: "POST",
      headers: {
        "Authorization": makeAuthHeader(),
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    }
    const req = https.request(options, (res) => {
      let data = ""
      res.on("data", (chunk) => { data += chunk })
      res.on("end", () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error("DataForSEO: invalid JSON response")) }
      })
    })
    req.on("error", reject)
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error("DataForSEO: timeout")) })
    req.write(payload)
    req.end()
  })
}

/**
 * Pull real SEO metrics for a domain via DataForSEO Labs.
 *
 * @param {string} domain          - bare domain, e.g. "acme.com"
 * @param {string} companyName
 * @param {string} niche           - campaign niche, used for opportunity keywords
 * @param {string} location        - prospect location string
 * @returns {Promise<Object>}
 */
export async function runSeoAudit(domain, companyName, niche, location) {
  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
    return buildFallback(domain, companyName, niche, location)
  }

  try {
    // Fetch domain overview and top ranked keywords in parallel
    const [overviewRes, rankedRes] = await Promise.all([
      dfsPost("/v3/dataforseo_labs/google/domain_rank_overview/live", [{
        target: domain,
        language_name: "English",
        location_name: "United States"
      }]),
      dfsPost("/v3/dataforseo_labs/google/ranked_keywords/live", [{
        target: domain,
        language_name: "English",
        location_name: "United States",
        limit: 10,
        order_by: ["keyword_data.keyword_info.search_volume,desc"]
      }])
    ])

    const organic = overviewRes?.tasks?.[0]?.result?.[0]?.metrics?.organic
    const rankedItems = rankedRes?.tasks?.[0]?.result?.[0]?.items || []

    const organicKeywords = organic?.count ?? 0
    const monthlyTraffic = Math.round(organic?.etv ?? 0)

    const topKeywords = rankedItems.slice(0, 6).map(item => ({
      keyword: item.keyword_data?.keyword ?? "",
      position: item.ranked_serp_element?.serp_item?.rank_absolute ?? 0,
      searchVolume: item.keyword_data?.keyword_info?.search_volume ?? 0
    })).filter(k => k.keyword)

    // Determine the single biggest visible gap
    const biggestGap = deriveBiggestGap(organicKeywords, monthlyTraffic, topKeywords, niche, location)

    return {
      domain,
      companyName,
      organicKeywords,
      monthlyTraffic,
      topKeywords,
      biggestGap,
      fallback_used: false
    }
  } catch (err) {
    console.warn("[seoAudit] DataForSEO error:", err.message)
    return buildFallback(domain, companyName, niche, location)
  }
}

function deriveBiggestGap(organicKeywords, monthlyTraffic, topKeywords, niche, location) {
  if (organicKeywords === 0) {
    return `${niche} searches in ${location} exist, but the site has zero organic keyword rankings`
  }
  if (topKeywords.length > 0) {
    const top = topKeywords[0]
    const vol = top.searchVolume ? `${top.searchVolume.toLocaleString()} monthly searches` : "notable search volume"
    if (top.position > 20) {
      return `Ranking at position ${top.position} (page ${Math.ceil(top.position / 10)}) for "${top.keyword}" which has ${vol}`
    }
    if (organicKeywords < 20) {
      return `Only ${organicKeywords} keyword ranking${organicKeywords === 1 ? "" : "s"} — missing most ${niche} search terms in ${location}`
    }
    return `Getting ~${monthlyTraffic.toLocaleString()} monthly visitors from Google — below market average for ${niche} in ${location}`
  }
  return `Limited organic search visibility for ${niche} services in ${location}`
}

function buildFallback(domain, companyName, niche, location) {
  return {
    domain,
    companyName,
    organicKeywords: null,
    monthlyTraffic: null,
    topKeywords: [],
    biggestGap: `Limited search visibility for ${niche || "your"} services in ${location}`,
    fallback_used: true
  }
}
