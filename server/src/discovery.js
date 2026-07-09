/**
 * discovery.js — Discovery and contact enrichment module
 *
 * Replaces Bing RSS with Google Maps Places API as the primary prospect
 * discovery source, with Bing RSS as a fallback. Also provides email
 * enrichment via Snov.io (with pattern-based fallback).
 *
 * Dependencies: Node.js built-ins + global fetch (Node 18+). No npm deps.
 */

// ---------------------------------------------------------------------------
// Blocked domains — aggregators, social networks, and directories that do not
// represent individual businesses worth outreaching.
// ---------------------------------------------------------------------------

export const blockedDomains = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "duckduckgo.com",
  "youtube.com",
  "yelp.com",
  "crunchbase.com",
  "wikipedia.org",
  "mapquest.com",
  "maps.google.com",
  "angieslist.com",
  "thumbtack.com",
  "houzz.com",
  "bbb.org",
  "yellowpages.com",
  "tripadvisor.com"
]

// ---------------------------------------------------------------------------
// URL utilities (identical to originals in store.js)
// ---------------------------------------------------------------------------

export function normalizeUrl(value) {
  const trimmed = String(value || "").trim()
  if (!trimmed) {
    return ""
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }
  return `https://${trimmed}`
}

export function rootUrl(url) {
  try {
    const parsed = new URL(normalizeUrl(url))
    return `${parsed.protocol}//${parsed.host}/`
  } catch {
    return normalizeUrl(url)
  }
}

export function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return ""
  }
}

export function isBlockedDomain(url) {
  const domain = extractDomain(url)
  return blockedDomains.some(blocked => domain === blocked || domain.endsWith(`.${blocked}`))
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stripTags(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
}

function extractMatch(text, regex) {
  const match = text.match(regex)
  return match ? match[1].replace(/\s+/g, " ").trim() : ""
}

function titleCase(value) {
  return String(value || "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function parseCompanyNameFromUrl(url) {
  const domain = extractDomain(url)
  if (!domain) {
    return "Unknown Company"
  }
  const core = domain.split(".")[0]
  return titleCase(core)
}

function looksInformationalTitle(value) {
  const lower = String(value || "").toLowerCase()
  return ["how much", "best ", "top ", "guide", "cost", "tips", "what is", "near me", "vs "].some(
    token => lower.includes(token)
  )
}

// ---------------------------------------------------------------------------
// Page snapshot — identical to fetchPageSnapshot in store.js
// ---------------------------------------------------------------------------

async function fetchText(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "MailOutreach-AuditBot/1.0" },
      signal: controller.signal
    })
    const text = await response.text()
    return { ok: response.ok, status: response.status, text }
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchPageSnapshot(url) {
  if (!url) {
    return {
      url: "",
      reachable: false,
      status: "missing",
      title: "",
      description: "",
      h1: "",
      bodySample: "",
      callToActionSignals: [],
      trustSignals: [],
      notes: ["No URL was provided for this source."]
    }
  }

  try {
    const response = await fetchText(url)
    const limitedHtml = response.text.slice(0, 120000)
    const cleanedBody = stripTags(limitedHtml).replace(/\s+/g, " ").trim()
    const title = extractMatch(limitedHtml, /<title[^>]*>([\s\S]*?)<\/title>/i)
    const description = extractMatch(
      limitedHtml,
      /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i
    )
    const h1 = extractMatch(limitedHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/i)

    const lowerHtml = limitedHtml.toLowerCase()
    const ctaKeywords = ["book", "demo", "schedule", "contact", "consult", "get started", "call"]
    const trustKeywords = ["testimonial", "case study", "review", "clients", "results", "portfolio"]
    const callToActionSignals = ctaKeywords.filter(keyword => lowerHtml.includes(keyword))
    const trustSignals = trustKeywords.filter(keyword => lowerHtml.includes(keyword))

    return {
      url,
      reachable: response.ok,
      status: `${response.status}`,
      title,
      description,
      h1,
      bodySample: cleanedBody.slice(0, 500),
      callToActionSignals,
      trustSignals,
      notes: response.ok ? [] : [`Source returned status ${response.status}.`]
    }
  } catch (error) {
    return {
      url,
      reachable: false,
      status: "error",
      title: "",
      description: "",
      h1: "",
      bodySample: "",
      callToActionSignals: [],
      trustSignals: [],
      notes: [
        `Could not fetch source: ${error.name === "AbortError" ? "request timed out" : error.message}`
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// Google Maps Places Text Search
// ---------------------------------------------------------------------------

export async function discoverWithGoogleMaps(niche, location, targetCount) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY not configured")
  }

  const query = `${niche} ${location}`
  const url =
    `https://maps.googleapis.com/maps/api/place/textsearch/json` +
    `?query=${encodeURIComponent(query)}` +
    `&key=${encodeURIComponent(apiKey)}` +
    `&fields=name,website,formatted_address,rating,user_ratings_total,place_id`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  let data
  try {
    const response = await fetch(url, { signal: controller.signal })
    data = await response.json()
  } finally {
    clearTimeout(timeout)
  }

  if (!Array.isArray(data.results)) {
    return []
  }

  return data.results
    .filter(result => result.website && !isBlockedDomain(result.website))
    .slice(0, targetCount)
    .map(result => ({
      companyName: result.name,
      websiteUrl: normalizeUrl(result.website),
      domain: extractDomain(result.website),
      address: result.formatted_address,
      rating: result.rating,
      totalRatings: result.user_ratings_total,
      placeId: result.place_id,
      source: "google_maps"
    }))
}

// ---------------------------------------------------------------------------
// Bing RSS fallback (internal — not exported)
// ---------------------------------------------------------------------------

function extractRssItems(xml) {
  const items = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi
  let match

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    items.push({
      title: extractMatch(block, /<title>([\s\S]*?)<\/title>/i),
      link: extractMatch(block, /<link>([\s\S]*?)<\/link>/i),
      description: extractMatch(block, /<description>([\s\S]*?)<\/description>/i)
    })
  }

  return items
}

async function discoverWithBingRss(query, targetCount) {
  const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`
  const response = await fetchText(url)
  if (!response.ok) {
    throw new Error(`Search provider returned status ${response.status}`)
  }

  const items = extractRssItems(response.text)
    .map(item => ({
      ...item,
      websiteUrl: rootUrl(item.link),
      domain: extractDomain(item.link)
    }))
    .filter(item => item.websiteUrl && item.domain && !isBlockedDomain(item.websiteUrl))
    .slice(0, Math.max(targetCount * 4, targetCount))

  return items.map(item => ({
    query,
    websiteUrl: item.websiteUrl,
    companyName:
      item.title && !looksInformationalTitle(item.title) && item.title.split(" ").length <= 8
        ? item.title.split("|")[0].split("-")[0].trim()
        : parseCompanyNameFromUrl(item.websiteUrl),
    domain: item.domain,
    searchTitle: item.title,
    searchDescription: item.description,
    source: "bing_rss"
  }))
}

// ---------------------------------------------------------------------------
// Unified prospect discovery — Google Maps first, Bing RSS fallback
// ---------------------------------------------------------------------------

export async function discoverProspects(niche, location, targetCount) {
  try {
    const results = await discoverWithGoogleMaps(niche, location, targetCount)
    if (results.length >= 2) {
      return results
    }
    // Fewer than 2 results — fall through to Bing RSS
    console.warn(
      `[discovery] Google Maps returned ${results.length} result(s) for "${niche} ${location}" — falling back to Bing RSS`
    )
  } catch (error) {
    console.warn(`[discovery] Google Maps failed (${error.message}) — falling back to Bing RSS`)
  }

  const fallbackQuery = `${niche} ${location} official website`
  return discoverWithBingRss(fallbackQuery, targetCount)
}

// ---------------------------------------------------------------------------
// Email enrichment — Snov.io
// ---------------------------------------------------------------------------

export async function findEmailWithSnov(domain) {
  const clientId = process.env.SNOV_CLIENT_ID
  const clientSecret = process.env.SNOV_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return []
  }

  try {
    // Step 1: obtain access token
    const tokenController = new AbortController()
    const tokenTimeout = setTimeout(() => tokenController.abort(), 10000)

    let token
    try {
      const tokenResponse = await fetch("https://api.snov.io/v1/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret
        }),
        signal: tokenController.signal
      })
      const tokenData = await tokenResponse.json()
      token = tokenData.access_token
    } finally {
      clearTimeout(tokenTimeout)
    }

    if (!token) {
      return []
    }

    // Step 2: fetch domain emails
    const emailController = new AbortController()
    const emailTimeout = setTimeout(() => emailController.abort(), 10000)

    let emailData
    try {
      const emailResponse = await fetch("https://api.snov.io/v2/domain-emails-with-info", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ domain, type: "all", limit: 5 }),
        signal: emailController.signal
      })
      emailData = await emailResponse.json()
    } finally {
      clearTimeout(emailTimeout)
    }

    const emails = emailData?.result?.emails
    if (!Array.isArray(emails)) {
      return []
    }
    return emails.map(entry => entry.email).filter(Boolean)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Pattern-based email guesser — fallback when no enrichment data is available
// ---------------------------------------------------------------------------

export function guessEmailPatterns(domain) {
  // Strip subdomains down to the registrable part, then take the first label
  // as the company's "core name", stripping non-alpha characters.
  const parts = domain.split(".")
  const coreName = parts[0].replace(/[^a-z0-9]/gi, "").toLowerCase()

  // These are generic role-based addresses that almost every company has —
  // they don't require knowing a person's name and clear most spam filters.
  return [
    `info@${domain}`,
    `contact@${domain}`,
    `hello@${domain}`,
    `admin@${domain}`
  ]
}

// ---------------------------------------------------------------------------
// Prospect enrichment — combines Snov.io and pattern fallback
// ---------------------------------------------------------------------------

export async function enrichProspect(companyName, websiteUrl, domain) {
  const snovEmails = await findEmailWithSnov(domain)

  if (snovEmails.length > 0) {
    return {
      emails: snovEmails,
      primaryEmail: snovEmails[0],
      enrichmentSource: "snov"
    }
  }

  const patternEmails = guessEmailPatterns(domain)
  if (patternEmails.length > 0) {
    return {
      emails: patternEmails,
      primaryEmail: patternEmails[0],
      enrichmentSource: "pattern"
    }
  }

  return {
    emails: [],
    primaryEmail: null,
    enrichmentSource: "none"
  }
}
