/**
 * apollo.js — Apollo.io owner/decision-maker enrichment
 *
 * Given a company domain (typically discovered via Google Maps in
 * discovery.js), find the owner / decision-maker's NAME and real EMAIL using
 * Apollo's People Search + People Match API.
 *
 * This is the "match Maps with Apollo" step: Google Maps knows the company and
 * its website; Apollo — keyed on that domain — knows the people and their
 * emails. Together they produce a personalized outreach contact.
 *
 * Requires APOLLO_API_KEY. Every call is wrapped so a failure returns null and
 * the pipeline degrades gracefully (same non-fatal pattern as the AI agents).
 *
 * Dependencies: Node.js built-ins + global fetch (Node 18+). No npm deps.
 */

const APOLLO_BASE = "https://api.apollo.io/api/v1"

// Titles that represent the "main contact" at a small/mid HVAC business,
// ordered roughly by how decision-making they are.
export const OWNER_TITLES = [
  "owner",
  "president",
  "ceo",
  "chief executive officer",
  "founder",
  "co-founder",
  "principal",
  "managing partner",
  "general manager",
  "vice president"
]

function apolloKey() {
  return process.env.APOLLO_API_KEY || ""
}

async function apolloPost(path, body, timeoutMs = 12000) {
  const key = apolloKey()
  if (!key) {
    throw new Error("APOLLO_API_KEY not configured")
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${APOLLO_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        // Apollo accepts the key either as an X-Api-Key header or an api_key
        // body field; we send the header (the currently documented method).
        "X-Api-Key": key
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(`Apollo ${path} → ${response.status} ${data?.error || ""}`.trim())
    }
    return data
  } finally {
    clearTimeout(timeout)
  }
}

// Apollo returns a masked placeholder (e.g. "email_not_unlocked@domain.com")
// when an email exists but isn't revealed on your plan. Treat those as "no
// email" so we never export an address we can't actually send to.
export function isRealEmail(email) {
  if (!email) {
    return false
  }
  const value = String(email).trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    return false
  }
  if (value.includes("not_unlocked") || value.includes("domain.com")) {
    return false
  }
  return true
}

function fullName(person) {
  return (
    person.name ||
    [person.first_name, person.last_name].filter(Boolean).join(" ").trim()
  )
}

// ---------------------------------------------------------------------------
// People Search — candidate owners at a given company domain
// ---------------------------------------------------------------------------

export async function searchOwnersByDomain(domain, titles = OWNER_TITLES, perPage = 10) {
  const data = await apolloPost("/mixed_people/search", {
    q_organization_domains: domain,
    person_titles: titles,
    page: 1,
    per_page: perPage
  })
  return Array.isArray(data.people) ? data.people : []
}

// ---------------------------------------------------------------------------
// People Match — reveal a specific person's email (consumes an Apollo credit)
// ---------------------------------------------------------------------------

export async function revealEmail({ firstName, lastName, domain }) {
  if (!firstName || !lastName || !domain) {
    return null
  }
  const data = await apolloPost("/people/match", {
    first_name: firstName,
    last_name: lastName,
    domain,
    reveal_personal_emails: false
  })
  const person = data.person || (Array.isArray(data.people) ? data.people[0] : null)
  return person && isRealEmail(person.email) ? person.email.toLowerCase() : null
}

// ---------------------------------------------------------------------------
// Public: find the best owner contact (name + real email) for a domain
// ---------------------------------------------------------------------------

export async function findOwnerContact(domain) {
  try {
    const people = await searchOwnersByDomain(domain)
    if (people.length === 0) {
      return null
    }

    // 1) Prefer anyone whose email is already unlocked in the search response.
    for (const person of people) {
      if (isRealEmail(person.email)) {
        return {
          name: fullName(person),
          title: person.title || "",
          email: person.email.toLowerCase(),
          source: "apollo_search"
        }
      }
    }

    // 2) Otherwise reveal the top (most senior) candidate's email via match.
    const top = people[0]
    const email = await revealEmail({
      firstName: top.first_name,
      lastName: top.last_name,
      domain
    })
    if (email) {
      return {
        name: fullName(top),
        title: top.title || "",
        email,
        source: "apollo_match"
      }
    }

    return null
  } catch (error) {
    console.warn(`[apollo] ${domain}: ${error.message}`)
    return null
  }
}
