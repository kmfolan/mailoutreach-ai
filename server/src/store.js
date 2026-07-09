import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  normalizeUrl,
  rootUrl,
  extractDomain,
  isBlockedDomain,
  discoverProspects,
  fetchPageSnapshot,
  enrichProspect
} from "./discovery.js";
import { researchProspect } from "./agents/research.js";
import { writeEmailSequence } from "./agents/emailWriter.js";
import { runSeoAudit } from "./agents/seoAudit.js";
import { scheduleSequence } from "./sender.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, "..", "data");
const dbPath = path.join(dataDir, "db.json");

const reportStatuses = ["Researching", "Drafted", "Reviewing", "Ready to Send", "Live"];
const runStatuses = ["Queued", "Running", "Completed", "Completed with Errors", "Failed"];

const baseDb = {
  profile: {
    productName: "MailOutreach AI",
    supportEmail: "ops@mailoutreach.app"
  },
  requests: [],
  reports: [],
  runs: [],
  activity: []
};

const activeRuns = new Map();

// In-memory email open/click tracking (resets on server restart)
const openEvents = new Map();   // trackingId -> [{at}]
const clickEvents = new Map();  // trackingId -> [{at, url}]
const reportTrackingMap = new Map(); // reportId -> [{step, trackingId}]

// In-memory audit page view tracking (resets on server restart)
const auditViewEvents = new Map(); // auditPageId -> [{at}]

function ensureDataFile() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(baseDb, null, 2));
  }
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadDb() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(dbPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...baseDb,
      ...parsed,
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      activity: Array.isArray(parsed.activity) ? parsed.activity : []
    };
  } catch {
    fs.writeFileSync(dbPath, JSON.stringify(baseDb, null, 2));
    return structuredClone(baseDb);
  }
}

const db = loadDb();

function persistDb() {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function toList(value) {
  return String(value || "")
    .split(/\r?\n|,/)
    .map(item => item.trim())
    .filter(Boolean);
}

function titleCase(value) {
  return String(value || "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function extractMatch(text, regex) {
  const match = text.match(regex);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

function parseCompanyNameFromUrl(url) {
  const domain = extractDomain(url);
  if (!domain) {
    return "Unknown Company";
  }
  const core = domain.split(".")[0];
  return titleCase(core);
}

function looksInformationalTitle(value) {
  const lower = String(value || "").toLowerCase();
  return ["how much", "best ", "top ", "guide", "cost", "tips", "what is", "near me", "vs "].some(token => lower.includes(token));
}

function buildDefaultChecklist(auditMode) {
  const shared = [
    "Confirm the target company and location match the campaign brief",
    "Review the website snapshot and validate the top conversion issue",
    "Approve the final outreach sequence before sending"
  ];

  const modeSpecific = {
    Agency: [
      "Check the homepage CTA and service clarity",
      "Note one trust or proof element that is missing"
    ],
    SEO: [
      "Review title/meta coverage and search positioning basics",
      "Capture the highest-value organic visibility gap"
    ],
    Social: [
      "Review visible posting or profile signals from provided sources",
      "Note whether social proof supports the offer"
    ],
    Mixed: [
      "Prioritize which channel issue matters most for the report",
      "Make sure the report recommendation matches the CTA"
    ]
  };

  return [...shared, ...(modeSpecific[auditMode] || modeSpecific.Mixed)].map(label => ({
    id: createId("task"),
    label,
    completed: false,
    completedAt: null
  }));
}

function buildIntentSignals(sourceSnapshots, painPoints) {
  const lowerPainPoints = painPoints.map(item => item.toLowerCase());
  const signals = [];

  for (const source of sourceSnapshots) {
    const body = `${source.title} ${source.description} ${source.bodySample}`.toLowerCase();
    const matchedPain = lowerPainPoints.find(item => item && body.includes(item));
    if (matchedPain) {
      signals.push(`The source at ${source.url} appears to mention or imply "${matchedPain}".`);
    }

    if (source.callToActionSignals.length === 0) {
      signals.push(`The source at ${source.url} does not show an obvious CTA signal from the quick scan.`);
    }
  }

  return Array.from(new Set(signals)).slice(0, 4);
}

function buildFindings(input, websiteSnapshot, sourceSnapshots) {
  const findings = [];
  const cta = input.cta;
  const painPoints = input.painPoints;
  const requirements = input.reportRequirements;

  if (!websiteSnapshot.reachable) {
    findings.push({
      title: "Website access needs manual review",
      severity: "High",
      evidence: websiteSnapshot.notes[0] || "The main website could not be fetched during the quick scan.",
      recommendation: "Verify the correct website URL and manually inspect the live site before sending outreach."
    });
  } else {
    if (!websiteSnapshot.description) {
      findings.push({
        title: "Missing or weak meta description",
        severity: "Medium",
        evidence: "The quick scan did not detect a usable meta description on the homepage.",
        recommendation: "Add a clearer meta description that ties the offer to the outcome the client wants."
      });
    }

    if (websiteSnapshot.callToActionSignals.length === 0) {
      findings.push({
        title: "Homepage CTA is not obvious from the quick scan",
        severity: "High",
        evidence: "The homepage content did not surface clear CTA language like book, contact, demo, or get started.",
        recommendation: `Lead the report with a CTA clarity recommendation tied directly to "${cta}".`
      });
    }

    if (websiteSnapshot.trustSignals.length === 0) {
      findings.push({
        title: "Proof elements look thin",
        severity: "Medium",
        evidence: "The scan did not find obvious trust markers like testimonials, case studies, or client proof.",
        recommendation: "Recommend adding one proof block near the main CTA to improve conversion confidence."
      });
    }
  }

  for (const painPoint of painPoints.slice(0, 3)) {
    findings.push({
      title: `Pain point focus: ${painPoint}`,
      severity: "Opportunity",
      evidence: `This campaign specifically wants to surface issues around "${painPoint}".`,
      recommendation: `Build at least one section of the report around how fixing "${painPoint}" supports "${cta}".`
    });
  }

  if (requirements.length > 0) {
    findings.push({
      title: "Custom reporting scope captured",
      severity: "Info",
      evidence: `The report needs to stay flexible for this client and include ${requirements.length} custom requirement areas.`,
      recommendation: "Use the custom report sections below as the final structure for delivery."
    });
  }

  return findings.slice(0, 8);
}

function buildCustomSections(input, websiteSnapshot, sourceSnapshots) {
  const baseEvidence = [
    websiteSnapshot.title ? `Homepage title: ${websiteSnapshot.title}` : "Homepage title was not available from the quick scan.",
    websiteSnapshot.h1 ? `Primary headline: ${websiteSnapshot.h1}` : "Primary homepage headline could not be confirmed.",
    sourceSnapshots.length > 0
      ? `Additional reviewed sources: ${sourceSnapshots.map(source => source.url).join(", ")}`
      : "No additional public source URLs were provided for this report."
  ];

  return input.reportRequirements.length > 0
    ? input.reportRequirements.map(requirement => ({
        title: requirement,
        bullets: [
          `Assess how ${requirement.toLowerCase()} affects the goal of "${input.cta}".`,
          `Tie findings back to ${input.companyName}'s market in ${input.location}.`,
          ...baseEvidence
        ].slice(0, 4)
      }))
    : [
        {
          title: "Website structure and offer clarity",
          bullets: [
            `Review whether the homepage structure quickly supports the CTA "${input.cta}".`,
            "Identify whether proof, offer, and next-step elements are easy to find.",
            ...baseEvidence.slice(0, 2)
          ]
        }
      ];
}

function buildExecutiveSummary(input, websiteSnapshot, sourceSnapshots, intentSignals) {
  const sourceCount = 1 + sourceSnapshots.length;
  const websiteLine = websiteSnapshot.reachable
    ? `The website scan captured live homepage content from ${input.websiteUrl}.`
    : "The primary website could not be fully fetched, so this report should be treated as a partial automated draft.";

  const intentLine = intentSignals.length > 0
    ? `Signal review surfaced ${intentSignals.length} angle${intentSignals.length === 1 ? "" : "s"} that can support personalized outreach.`
    : "No strong public intent signal was found from the provided sources, so the outreach should lead with problem awareness rather than urgency.";

  return [
    `${input.companyName} in ${input.location} was reviewed against the CTA "${input.cta}".`,
    websiteLine,
    `${sourceCount} source${sourceCount === 1 ? " was" : "s were"} considered for this draft.`,
    intentLine
  ].join(" ");
}

// Template fallback used when AI sequence writing fails
function buildSequenceFallback(input, findings, intentSignals) {
  const topFinding = findings[0]?.title || "one clear growth blocker";
  const topPain = input.painPoints[0] || "conversion gaps";
  const intentReference = intentSignals[0] || `I noticed a few likely issues related to ${topPain}.`;

  return [
    {
      step: 1,
      subject: `${input.companyName}: quick idea around ${topPain}`,
      body: `Hi ${input.companyName} team,\n\nI took a quick look at your public web presence in ${input.location}. ${intentReference}\n\nThe biggest immediate gap I noticed was ${topFinding.toLowerCase()}. I put together a short report showing what I would change first and how it ties back to ${input.cta}.\n\nWorth sending it over?`
    },
    {
      step: 2,
      subject: `A few notes on ${input.companyName}'s funnel`,
      body: `Following up because I mapped a few friction points around ${topPain}.\n\nThe report is not generic. I focused it around your current CTA, your location, and the specific issues that would likely slow response or conversion.\n\nIf helpful, I can send the breakdown and the top fixes in plain English.`
    },
    {
      step: 3,
      subject: `Should I close this out?`,
      body: `Last note from me.\n\nI drafted a client-specific report for ${input.companyName} that covers the main issues, what likely needs work, and the fastest recommendations to support ${input.cta}.\n\nIf now is not a priority, no worries. If it is, I can send the report over and you can decide if it is useful.`
    }
  ];
}

function normalizeReport(report) {
  const checklist = Array.isArray(report.checklist) ? report.checklist : [];
  const normalizedChecklist = checklist.map(item => ({
    id: item.id || createId("task"),
    label: item.label || "Checklist item",
    completed: Boolean(item.completed),
    completedAt: item.completedAt || null
  }));
  const checklistCompleted = normalizedChecklist.filter(item => item.completed).length;

  return {
    ...report,
    status: reportStatuses.includes(report.status) ? report.status : "Drafted",
    checklist: normalizedChecklist,
    checklistCompleted,
    checklistTotal: normalizedChecklist.length,
    progressPercent: normalizedChecklist.length > 0 ? Math.round((checklistCompleted / normalizedChecklist.length) * 100) : 0
  };
}

function normalizeRun(run) {
  return {
    ...run,
    status: runStatuses.includes(run.status) ? run.status : "Queued",
    discoveredProspects: Array.isArray(run.discoveredProspects) ? run.discoveredProspects : [],
    reportIds: Array.isArray(run.reportIds) ? run.reportIds : [],
    logs: Array.isArray(run.logs) ? run.logs : [],
    errors: Array.isArray(run.errors) ? run.errors : [],
    completedCount: run.completedCount || 0,
    targetCount: run.targetCount || 0
  };
}

function logActivity(title, body, createdAt = new Date().toISOString()) {
  db.activity.unshift({
    id: createId("activity"),
    createdAt,
    title,
    body
  });
}

function findReport(reportId) {
  return db.reports.find(report => report.id === reportId) || null;
}

function findRun(runId) {
  return db.runs.find(run => run.id === runId) || null;
}

function syncStoredRecords() {
  db.reports = db.reports.map(normalizeReport);
  db.requests = db.requests.map(request => ({
    ...request,
    reportId: request.reportId || null,
    status: request.status || "Drafted"
  }));
  db.runs = db.runs.map(normalizeRun);
  persistDb();
}

syncStoredRecords();

function buildReportInput(payload, overrides = {}) {
  return {
    companyName: overrides.companyName || payload.companyName,
    websiteUrl: normalizeUrl(overrides.websiteUrl || payload.websiteUrl),
    location: overrides.location || payload.location,
    cta: payload.cta,
    auditMode: payload.auditMode,
    painPoints: Array.isArray(payload.painPoints) ? payload.painPoints : toList(payload.painPoints),
    reportRequirements: Array.isArray(payload.reportRequirements) ? payload.reportRequirements : toList(payload.reportRequirements),
    sourceUrls: Array.isArray(payload.sourceUrls) ? payload.sourceUrls.map(normalizeUrl) : toList(payload.sourceUrls).map(normalizeUrl),
    notes: payload.notes || ""
  };
}

async function buildReportRecordFromInput(input, metadata = {}) {
  const websiteSnapshot = await fetchPageSnapshot(input.websiteUrl);
  const sourceSnapshots = [];
  for (const url of input.sourceUrls.slice(0, 4)) {
    sourceSnapshots.push(await fetchPageSnapshot(url));
  }

  const intentSignals = buildIntentSignals(sourceSnapshots, input.painPoints);
  const findings = buildFindings(input, websiteSnapshot, sourceSnapshots);
  const customSections = buildCustomSections(input, websiteSnapshot, sourceSnapshots);
  const executiveSummary = buildExecutiveSummary(input, websiteSnapshot, sourceSnapshots, intentSignals);

  // AI research pass — build a prospect profile from the snapshot
  const campaignContext = {
    cta: input.cta,
    auditMode: input.auditMode,
    painPoints: input.painPoints,
    reportRequirements: input.reportRequirements,
    location: input.location
  };

  let prospectProfile = null;
  let sequenceSource = "template";

  try {
    prospectProfile = await researchProspect(websiteSnapshot, campaignContext);
  } catch (error) {
    console.warn(`[AI] Research agent failed for ${input.companyName}: ${error.message}`);
  }

  // SEO audit pass — pull real DataForSEO metrics for this domain
  const domain = extractDomain(input.websiteUrl) || input.websiteUrl;
  const auditPageId = createId("audit");
  const trackingHost = process.env.TRACKING_HOST || `localhost:${process.env.PORT || 4021}`;
  const auditPageUrl = `https://${trackingHost}/audit/${auditPageId}`;

  let seoAudit = null;
  try {
    const auditResult = await runSeoAudit(domain, input.companyName, input.auditMode, input.location);
    if (!auditResult.fallback_used) {
      seoAudit = auditResult;
    }
  } catch (error) {
    console.warn(`[AI] SEO audit failed for ${input.companyName}: ${error.message}`);
  }

  // AI email sequence — use Claude to write personalized emails
  const campaignBrief = {
    cta: input.cta,
    auditMode: input.auditMode,
    painPoints: input.painPoints,
    reportRequirements: input.reportRequirements,
    location: input.location,
    companyName: input.companyName,
    auditPageUrl,
    seoAudit
  };

  let outreachSequence;
  try {
    if (prospectProfile && !prospectProfile.fallback_used) {
      outreachSequence = await writeEmailSequence(prospectProfile, campaignBrief);
      sequenceSource = "ai";
    } else {
      outreachSequence = buildSequenceFallback(input, findings, intentSignals);
    }
  } catch (error) {
    console.warn(`[AI] Email writer failed for ${input.companyName}: ${error.message}`);
    outreachSequence = buildSequenceFallback(input, findings, intentSignals);
  }

  return normalizeReport({
    id: createId("report"),
    createdAt: new Date().toISOString(),
    companyName: input.companyName,
    websiteUrl: input.websiteUrl,
    location: input.location,
    cta: input.cta,
    auditMode: input.auditMode,
    painPoints: input.painPoints,
    reportRequirements: input.reportRequirements,
    sourceUrls: input.sourceUrls,
    notes: input.notes,
    websiteSnapshot,
    sourceSnapshots,
    intentSignals,
    executiveSummary,
    findings,
    customSections,
    outreachSequence,
    prospectProfile: prospectProfile && !prospectProfile.fallback_used ? prospectProfile : null,
    seoAudit,
    auditPageId,
    auditPageUrl,
    sequenceSource,
    enrichedEmails: metadata.enrichedEmails || [],
    sendInfo: null,
    status: metadata.initialStatus || "Drafted",
    checklist: buildDefaultChecklist(input.auditMode),
    autonomousRunId: metadata.autonomousRunId || null,
    discoveredFromQuery: metadata.discoveredFromQuery || null
  });
}

async function buildReportRecord(payload) {
  return buildReportRecordFromInput(buildReportInput(payload));
}

function summarizeDashboard() {
  const latestReport = db.reports[0] || null;
  const readyToSend = db.reports.filter(report => report.status === "Ready to Send" || report.status === "Live").length;
  const activeRunsCount = db.runs.filter(run => run.status === "Queued" || run.status === "Running").length;

  return latestReport
    ? {
        activeReports: db.reports.length,
        readyToSend,
        latestCompany: latestReport.companyName,
        latestLocation: latestReport.location,
        sourceCoverage: 1 + (latestReport.sourceSnapshots?.length || 0),
        activeRuns: activeRunsCount
      }
    : {
        activeReports: 0,
        readyToSend: 0,
        latestCompany: null,
        latestLocation: null,
        sourceCoverage: 0,
        activeRuns: activeRunsCount
      };
}

function appendRunLog(run, message) {
  run.logs.unshift({
    id: createId("log"),
    createdAt: new Date().toISOString(),
    message
  });
  run.logs = run.logs.slice(0, 30);
}

async function qualifyProspect(prospect, run) {
  const snapshot = await fetchPageSnapshot(prospect.websiteUrl);
  const haystack = `${prospect.searchTitle || ""} ${prospect.searchDescription || ""} ${snapshot.title} ${snapshot.description} ${snapshot.h1} ${snapshot.bodySample}`.toLowerCase();
  const nicheTokens = run.niche
    .toLowerCase()
    .split(/\s+/)
    .filter(token => token.length > 3 && !["official", "website", "local", "company", "services"].includes(token));
  const locationTokens = run.location
    .toLowerCase()
    .split(/[,\s]+/)
    .filter(token => token.length > 2);

  const nicheMatch = nicheTokens.length === 0 || nicheTokens.some(token => haystack.includes(token));
  const locationMatch = locationTokens.length === 0 || locationTokens.some(token => haystack.includes(token));
  const informational = looksInformationalTitle(prospect.searchTitle) || /blog|article|news/i.test(prospect.searchDescription || "");

  return {
    accepted: snapshot.reachable && nicheMatch && !informational && (locationMatch || Boolean(prospect.searchDescription || prospect.searchTitle)),
    snapshot
  };
}

async function processAutonomousRun(runId) {
  const run = findRun(runId);
  if (!run || activeRuns.has(runId)) {
    return;
  }

  activeRuns.set(runId, true);
  run.status = "Running";
  run.startedAt = new Date().toISOString();
  appendRunLog(run, "Autonomous discovery started.");
  persistDb();

  try {
    const seenDomains = new Set();
    const prospects = [];

    appendRunLog(run, `Searching for "${run.niche}" in "${run.location}".`);
    persistDb();

    try {
      const results = await discoverProspects(run.niche, run.location, run.targetCount * 4);
      for (const result of results) {
        if (prospects.length >= run.targetCount) {
          break;
        }

        if (!result.domain || seenDomains.has(result.domain)) {
          continue;
        }

        const qualified = await qualifyProspect(result, run);
        if (!qualified.accepted) {
          continue;
        }

        seenDomains.add(result.domain);
        prospects.push(result);
      }
    } catch (error) {
      run.errors.push(`Discovery failed: ${error.message}`);
      appendRunLog(run, `Search failed: ${error.message}`);
    }

    if (prospects.length === 0) {
      throw new Error("No public prospects were discovered from the current search brief.");
    }

    for (const prospect of prospects.slice(0, run.targetCount)) {
      appendRunLog(run, `Building report draft for ${prospect.companyName}.`);

      // AI enrichment — find contact emails before building the report
      let enrichedEmails = [];
      try {
        const enrichResult = await enrichProspect(prospect.companyName, prospect.websiteUrl, prospect.domain);
        enrichedEmails = enrichResult.emails || [];
        if (enrichedEmails.length > 0) {
          appendRunLog(run, `Found ${enrichedEmails.length} contact email(s) for ${prospect.companyName} via ${enrichResult.enrichmentSource}.`);
        }
      } catch {
        // Enrichment failure should not stop report generation.
      }

      const reportInput = buildReportInput({
        companyName: prospect.companyName,
        websiteUrl: prospect.websiteUrl,
        location: run.location,
        cta: run.cta,
        auditMode: run.auditMode,
        painPoints: run.painPoints,
        reportRequirements: run.reportRequirements,
        sourceUrls: [],
        notes: run.notes
      });

      const report = await buildReportRecordFromInput(reportInput, {
        initialStatus: "Researching",
        autonomousRunId: run.id,
        discoveredFromQuery: prospect.query,
        enrichedEmails
      });

      db.reports.unshift(report);
      db.requests.unshift({
        id: createId("request"),
        reportId: report.id,
        createdAt: report.createdAt,
        companyName: report.companyName,
        websiteUrl: report.websiteUrl,
        location: report.location,
        status: report.status
      });

      run.reportIds.unshift(report.id);
      run.discoveredProspects.unshift({
        id: createId("prospect"),
        companyName: report.companyName,
        websiteUrl: report.websiteUrl,
        enrichedEmails,
        status: report.status,
        reportId: report.id,
        discoveredFromQuery: prospect.query
      });
      run.completedCount += 1;

      logActivity(
        "Autonomous report drafted",
        `${report.companyName} was discovered${enrichedEmails.length > 0 ? ` (${enrichedEmails.length} email contact found)` : ""} and converted into a draft outreach report using AI-written copy.`
      );
      persistDb();
    }

    run.completedAt = new Date().toISOString();
    run.status = run.errors.length > 0 ? "Completed with Errors" : "Completed";
    appendRunLog(run, `Autonomous run finished with ${run.completedCount} drafted prospect report${run.completedCount === 1 ? "" : "s"}.`);
    persistDb();
  } catch (error) {
    run.completedAt = new Date().toISOString();
    run.status = "Failed";
    run.errors.push(error.message);
    appendRunLog(run, `Run failed: ${error.message}`);
    persistDb();
  } finally {
    activeRuns.delete(runId);
  }
}

// ── Tracking ──────────────────────────────────────────────────────────────────

export function recordAuditView(auditPageId) {
  const events = auditViewEvents.get(auditPageId) || [];
  events.push({ at: new Date().toISOString() });
  auditViewEvents.set(auditPageId, events);
}

export function getAuditPage(auditPageId) {
  const report = db.reports.find(r => r.auditPageId === auditPageId) || null;
  if (!report) return null;
  const views = auditViewEvents.get(auditPageId) || [];
  return { report, viewCount: views.length };
}

export function recordOpen(trackingId) {
  const events = openEvents.get(trackingId) || [];
  events.push({ at: new Date().toISOString() });
  openEvents.set(trackingId, events);
}

export function recordClick(trackingId, url) {
  const events = clickEvents.get(trackingId) || [];
  events.push({ at: new Date().toISOString(), url });
  clickEvents.set(trackingId, events);
}

export function getSendStatus(reportId) {
  const report = findReport(reportId);
  if (!report) {
    return null;
  }

  const trackingIds = reportTrackingMap.get(reportId) || [];
  return {
    sendInfo: report.sendInfo || null,
    tracking: trackingIds.map(({ step, trackingId }) => ({
      step,
      opens: (openEvents.get(trackingId) || []).length,
      clicks: (clickEvents.get(trackingId) || []).length,
      lastOpen: (openEvents.get(trackingId) || []).at(-1)?.at || null,
      lastClick: (clickEvents.get(trackingId) || []).at(-1)?.at || null
    }))
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

export function getHealth() {
  return {
    ok: true,
    service: "mailoutreach-ai-server",
    updatedAt: new Date().toISOString()
  };
}

export function getDashboard() {
  const latestReport = db.reports[0] || null;

  return {
    profile: db.profile,
    summary: summarizeDashboard(),
    latestReport,
    recentRequests: db.requests.slice(0, 8),
    activity: db.activity.slice(0, 12),
    reportHistory: db.reports.slice(0, 12),
    autonomousRuns: db.runs.slice(0, 8),
    availableStatuses: reportStatuses,
    runStatuses
  };
}

export function getPlanById(reportId) {
  return findReport(reportId);
}

export function getAutonomousRunById(runId) {
  return findRun(runId);
}

export async function submitSetupRequest(payload) {
  const report = await buildReportRecord(payload);
  const request = {
    id: createId("request"),
    reportId: report.id,
    createdAt: report.createdAt,
    companyName: report.companyName,
    websiteUrl: report.websiteUrl,
    location: report.location,
    status: report.status
  };

  db.requests.unshift(request);
  db.reports.unshift(report);
  logActivity(
    "New audit report drafted",
    `${report.companyName} was analyzed for a ${report.auditMode.toLowerCase()} outreach report${report.sequenceSource === "ai" ? " with AI-written email copy" : ""}.`,
    report.createdAt
  );
  logActivity(
    "3-email sequence generated",
    `${formatDate(new Date(report.createdAt))}: ${report.sequenceSource === "ai" ? "Claude wrote a personalized" : "Template"} outreach sequence for ${report.companyName}.`,
    report.createdAt
  );
  persistDb();
  return { request, plan: report };
}

export function createAutonomousRun(payload) {
  const run = normalizeRun({
    id: createId("run"),
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    campaignName: payload.campaignName,
    niche: payload.niche,
    location: payload.location,
    cta: payload.cta,
    auditMode: payload.auditMode,
    painPoints: toList(payload.painPoints),
    reportRequirements: toList(payload.reportRequirements),
    platformTargets: toList(payload.platformTargets),
    notes: payload.notes || "",
    targetCount: Math.max(1, Math.min(10, Number(payload.targetCount) || 3)),
    completedCount: 0,
    status: "Queued",
    discoveredProspects: [],
    reportIds: [],
    logs: [],
    errors: []
  });

  appendRunLog(run, "Autonomous run queued.");
  db.runs.unshift(run);
  logActivity("Autonomous run queued", `${run.campaignName} is queued to discover ${run.targetCount} prospects in ${run.location}.`, run.createdAt);
  persistDb();

  setTimeout(() => processAutonomousRun(run.id), 0);
  return run;
}

export function updatePlanStatus(reportId, status) {
  if (!reportStatuses.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  const report = findReport(reportId);
  if (!report) {
    throw new Error("Plan not found");
  }

  report.status = status;
  persistDb();
  return normalizeReport(report);
}

export function updateChecklistItem(reportId, itemId, completed) {
  const report = findReport(reportId);
  if (!report) {
    throw new Error("Plan not found");
  }

  const item = (report.checklist || []).find(c => c.id === itemId);
  if (!item) {
    throw new Error("Checklist item not found");
  }

  item.completed = Boolean(completed);
  item.completedAt = completed ? new Date().toISOString() : null;
  persistDb();
  return normalizeReport(report);
}

export async function scheduleSend(reportId, sendConfig) {
  const report = findReport(reportId);
  if (!report) {
    throw new Error("Plan not found");
  }

  if (!report.outreachSequence || report.outreachSequence.length === 0) {
    throw new Error("Report has no outreach sequence to send");
  }

  // Build tracking IDs for each step
  const stepsWithTracking = report.outreachSequence.map(email => ({
    ...email,
    trackingId: createId("track"),
    to: sendConfig.recipientEmail || sendConfig.to || "",
    from: sendConfig.from || process.env.SMTP_USER || "",
    replyTo: sendConfig.replyTo || process.env.SMTP_USER || ""
  }));

  // Register tracking IDs in memory
  reportTrackingMap.set(
    reportId,
    stepsWithTracking.map(s => ({ step: s.step, trackingId: s.trackingId }))
  );

  // Persist send info to the report record
  report.sendInfo = {
    scheduledAt: new Date().toISOString(),
    to: sendConfig.recipientEmail || sendConfig.to || "",
    steps: stepsWithTracking.map(s => ({
      step: s.step,
      trackingId: s.trackingId
    }))
  };
  persistDb();

  // Hand off to sender
  scheduleSequence(reportId, stepsWithTracking, {
    toEmail: sendConfig.recipientEmail || sendConfig.to || "",
    from: sendConfig.from || process.env.SMTP_USER || "",
    replyTo: sendConfig.replyTo || process.env.SMTP_USER || ""
  });

  return normalizeReport(report);
}
