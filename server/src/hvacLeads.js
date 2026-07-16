/**
 * hvacLeads.js — HVAC lead-generation pipeline
 *
 * Orchestrates the "match Maps with Apollo" flow:
 *   1. Discover companies via Google Maps Places (name, website, domain, address)
 *   2. Pull the phone number via Place Details
 *   3. Enrich the owner name + real email via Apollo (keyed on the domain)
 *   4. Drop any record with no email; de-duplicate by domain and by email
 *
 * The output is an array of flat lead records ready for CSV export.
 *
 * Runs anywhere Node 18+ has network egress to maps.googleapis.com and
 * api.apollo.io. If APOLLO_API_KEY is absent (or useApollo:false), it falls
 * back to role-based pattern emails (info@domain) so the company skeleton can
 * still be built from Maps alone.
 *
 * Dependencies: Node.js built-ins + global fetch. No npm deps.
 */

import {
  extractDomain,
  normalizeUrl,
  isBlockedDomain,
  guessEmailPatterns,
  scrapeSiteEmails,
  pickBestEmail
} from "./discovery.js"
import { findOwnerContact } from "./apollo.js"
import { verifyEmail } from "./emailVerify.js"

export const DEFAULT_TERMS = ["HVAC contractor", "air conditioning repair", "heating and cooling"]

// A spread of large US metros. Google Maps returns ~20 places per page (up to
// ~60 with pagination), so coverage comes from breadth: terms × cities × pages.
export const DEFAULT_CITIES = [
  "New York, NY", "Los Angeles, CA", "Chicago, IL", "Houston, TX",
  "Phoenix, AZ", "Philadelphia, PA", "San Antonio, TX", "San Diego, CA",
  "Dallas, TX", "San Jose, CA", "Austin, TX", "Jacksonville, FL",
  "Fort Worth, TX", "Columbus, OH", "Charlotte, NC", "Indianapolis, IN",
  "San Francisco, CA", "Seattle, WA", "Denver, CO", "Nashville, TN",
  "Oklahoma City, OK", "Las Vegas, NV", "Detroit, MI", "Memphis, TN",
  "Louisville, KY", "Baltimore, MD", "Milwaukee, WI", "Albuquerque, NM",
  "Tucson, AZ", "Atlanta, GA"
]

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// Google Maps: paginated Text Search (up to 3 pages / ~60 results per query)
// ---------------------------------------------------------------------------

export async function searchPlaces(niche, location, maxResults = 60) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY not configured")
  }

  const query = `${niche} ${location}`
  const collected = []
  let pageToken = ""

  for (let page = 0; page < 3 && collected.length < maxResults; page++) {
    const url =
      `https://maps.googleapis.com/maps/api/place/textsearch/json` +
      `?query=${encodeURIComponent(query)}` +
      `&key=${encodeURIComponent(apiKey)}` +
      (pageToken ? `&pagetoken=${encodeURIComponent(pageToken)}` : "")

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    let data
    try {
      const response = await fetch(url, { signal: controller.signal })
      data = await response.json()
    } finally {
      clearTimeout(timeout)
    }

    for (const result of data.results || []) {
      if (!result.website || isBlockedDomain(result.website)) {
        continue
      }
      collected.push({
        companyName: result.name,
        websiteUrl: normalizeUrl(result.website),
        domain: extractDomain(result.website),
        address: result.formatted_address || "",
        placeId: result.place_id,
        source: "google_maps"
      })
    }

    pageToken = data.next_page_token || ""
    if (!pageToken) {
      break
    }
    // Google requires a short delay before a page token becomes valid.
    await sleep(2000)
  }

  return collected.slice(0, maxResults)
}

// ---------------------------------------------------------------------------
// Google Maps: Place Details — phone number (+ backfill address/website)
// ---------------------------------------------------------------------------

export async function fetchPlaceDetails(placeId) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey || !placeId) {
    return { phone: "", address: "", website: "" }
  }

  const url =
    `https://maps.googleapis.com/maps/api/place/details/json` +
    `?place_id=${encodeURIComponent(placeId)}` +
    `&fields=formatted_phone_number,formatted_address,website,name` +
    `&key=${encodeURIComponent(apiKey)}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    const data = await response.json()
    const r = data.result || {}
    return {
      phone: r.formatted_phone_number || "",
      address: r.formatted_address || "",
      website: r.website || ""
    }
  } catch {
    return { phone: "", address: "", website: "" }
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Build HVAC leads via the enrichment waterfall:
 *   1. Google Maps discovery (company, website, phone, address)
 *   2. Apollo enrichment by domain (owner name + email)      [useApollo]
 *   3. Website-scrape fallback for a role email              [scrape]
 *   4. Pattern email as last resort (info@domain)            [patterns]
 *   5. MX / SMTP verification; drop undeliverable            [verify / smtp]
 *
 * @param {object} opts
 * @param {string[]} [opts.terms]     search terms
 * @param {string[]} [opts.cities]    metros to search
 * @param {number}   [opts.target]    stop after this many kept leads
 * @param {boolean}  [opts.useApollo] enrich owner name+email via Apollo
 * @param {boolean}  [opts.scrape]    fall back to scraping the company site
 * @param {boolean}  [opts.patterns]  last-resort role email (info@domain)
 * @param {boolean}  [opts.verify]    MX-verify emails, drop undeliverable
 * @param {boolean}  [opts.smtp]      also SMTP-probe mailboxes (slow, opt-in)
 * @param {string}   [opts.from]      MAIL FROM identity for SMTP probing
 * @param {boolean}  [opts.withPhone] fetch phone via Place Details (extra calls)
 * @param {(n:number, lead:object)=>void} [opts.onProgress]
 * @returns {Promise<object[]>} lead records
 */
export async function buildHvacLeads(opts = {}) {
  const {
    terms = DEFAULT_TERMS,
    cities = DEFAULT_CITIES,
    target = 5000,
    useApollo = true,
    scrape = true,
    patterns = false,
    verify = true,
    smtp = false,
    from = "verify@example.com",
    withPhone = true,
    onProgress
  } = opts

  const seenDomain = new Set()
  const seenEmail = new Set()
  const leads = []

  for (const city of cities) {
    for (const term of terms) {
      if (leads.length >= target) {
        return leads
      }

      let companies = []
      try {
        companies = await searchPlaces(term, city, 60)
      } catch (error) {
        console.warn(`[hvac] Maps "${term} ${city}" failed: ${error.message}`)
        continue
      }

      for (const company of companies) {
        if (leads.length >= target) {
          break
        }
        if (!company.domain || seenDomain.has(company.domain)) {
          continue
        }
        seenDomain.add(company.domain)

        // Phone (and address backfill) from Place Details.
        let phone = ""
        let address = company.address
        if (withPhone) {
          const details = await fetchPlaceDetails(company.placeId)
          phone = details.phone
          if (!address) {
            address = details.address
          }
        }

        // ── Enrichment waterfall ──────────────────────────────────────────
        let contactName = ""
        let title = ""
        let email = ""
        let emailSource = ""

        // Layer 2: Apollo — owner name + real email (keyed on domain).
        if (useApollo) {
          const contact = await findOwnerContact(company.domain)
          if (contact) {
            contactName = contact.name
            title = contact.title
            email = contact.email
            emailSource = contact.source
          }
        }

        // Layer 3: scrape the company's own site for a published email.
        if (!email && scrape) {
          const scraped = await scrapeSiteEmails(company.websiteUrl)
          const best = pickBestEmail(scraped, company.domain)
          if (best) {
            email = best
            emailSource = "website"
          }
        }

        // Layer 4: last-resort role-based pattern email (info@domain).
        if (!email && patterns) {
          email = guessEmailPatterns(company.domain)[0] || ""
          emailSource = "pattern"
        }

        // Requirement: never keep a contact without an email.
        if (!email || seenEmail.has(email)) {
          continue
        }

        // Layer 5: verify deliverability; drop dead domains / rejected mailboxes.
        let verifyStatus = "unverified"
        if (verify) {
          const result = await verifyEmail(email, { smtp, from })
          verifyStatus = result.status
          if (!result.ok) {
            continue
          }
        }

        seenEmail.add(email)

        const lead = {
          company: company.companyName,
          contactName,
          title,
          email,
          emailSource,
          verifyStatus,
          website: company.websiteUrl,
          domain: company.domain,
          address,
          phone
        }
        leads.push(lead)
        if (onProgress) {
          onProgress(leads.length, lead)
        }
      }
    }
  }

  return leads
}
