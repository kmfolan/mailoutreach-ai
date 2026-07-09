import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  createAutonomousRun,
  getAutonomousRunById,
  getDashboard,
  getHealth,
  getPlanById,
  submitSetupRequest,
  updateChecklistItem,
  updatePlanStatus,
  recordOpen,
  recordClick,
  getSendStatus,
  scheduleSend,
  recordAuditView,
  getAuditPage
} from "./store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const envPath = path.join(rootDir, ".env");

loadEnvFile(envPath);

const port = Number(process.env.PORT || 4021);

const sessionStore = new Map();
const rateLimitStore = new Map();

const generatedPassword = crypto.randomBytes(12).toString("base64url");
const authConfig = {
  username: process.env.AUTH_USERNAME || "admin",
  password: process.env.AUTH_PASSWORD || generatedPassword,
  sessionSecret: process.env.AUTH_SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  secureCookies: process.env.COOKIE_SECURE === "true",
  sessionTtlMs: 1000 * 60 * 60 * 8
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

const securityHeaders = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com data:; " +
    "img-src 'self' data:; " +
    "connect-src 'self'; " +
    "object-src 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'; " +
    "frame-ancestors 'none'"
};

const loginPage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MailOutreach AI Login</title>
  <style>
    :root { color-scheme: dark; --bg:#08101a; --panel:rgba(14,20,35,.92); --border:rgba(152,182,255,.14); --text:#f3f7fc; --muted:#9baac4; --accent:#8ee3c4; }
    * { box-sizing:border-box; } body { margin:0; min-height:100vh; display:grid; place-items:center; font-family:Manrope,Arial,sans-serif; color:var(--text); background:radial-gradient(circle at top left, rgba(140,168,255,.16), transparent 28%), radial-gradient(circle at 90% 15%, rgba(142,227,196,.12), transparent 24%), linear-gradient(180deg, #08101a 0%, #050910 100%); }
    .card { width:min(460px, calc(100% - 24px)); padding:24px; border-radius:24px; border:1px solid var(--border); background:var(--panel); box-shadow:0 28px 80px rgba(0,0,0,.34); }
    h1,p { margin:0; } h1 { font-size:2rem; margin-bottom:10px; } p { color:var(--muted); margin-bottom:18px; line-height:1.6; }
    form { display:grid; gap:14px; } label { display:grid; gap:8px; color:var(--text); font-weight:600; } input { width:100%; padding:13px 14px; border-radius:14px; border:1px solid var(--border); background:#09111d; color:var(--text); font:inherit; }
    button { border:0; border-radius:999px; padding:13px 18px; font:inherit; font-weight:700; cursor:pointer; color:#08101a; background:linear-gradient(135deg, var(--accent), #cbffe9); }
    .error { min-height:24px; color:#ff8c88; }
    .ai-badge { display:inline-block; background:rgba(142,227,196,.12); border:1px solid rgba(142,227,196,.3); border-radius:8px; padding:4px 10px; font-size:12px; font-weight:700; color:var(--accent); margin-bottom:12px; letter-spacing:.05em; }
  </style>
</head>
<body>
  <main class="card">
    <div class="ai-badge">AI Edition</div>
    <h1>Protected Workspace</h1>
    <p>Sign in to access the MailOutreach AI dashboard and API.</p>
    <form id="login-form">
      <label>Username<input name="username" autocomplete="username" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit">Sign in</button>
      <div class="error" id="login-error"></div>
    </form>
  </main>
  <script>
    const form = document.getElementById("login-form");
    const errorNode = document.getElementById("login-error");
    form.addEventListener("submit", async event => {
      event.preventDefault();
      errorNode.textContent = "";
      const formData = new FormData(form);
      const payload = { username: formData.get("username"), password: formData.get("password") };
      const response = await fetch("/api/auth/login", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) { errorNode.textContent = data.error || "Login failed"; return; }
      window.location.href = "/";
    });
  </script>
</body>
</html>`;

function buildAuditPage(report) {
  const company = report.companyName || "Your Business";
  const website = report.websiteUrl || "";
  const location = report.location || "";
  const seo = report.seoAudit;

  const hasRealData = seo && !seo.fallback_used && seo.organicKeywords !== null;

  const metricCards = hasRealData ? `
    <div class="metric-card">
      <div class="metric-value">${seo.organicKeywords.toLocaleString()}</div>
      <div class="metric-label">Keywords Ranking</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">${seo.monthlyTraffic.toLocaleString()}</div>
      <div class="metric-label">Monthly Organic Visitors</div>
    </div>
    <div class="metric-card accent">
      <div class="metric-value">${seo.topKeywords.length > 0 ? "#" + seo.topKeywords[0].position : "—"}</div>
      <div class="metric-label">Top Keyword Position</div>
    </div>` : `
    <div class="metric-card">
      <div class="metric-value">—</div>
      <div class="metric-label">Organic Keywords</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">—</div>
      <div class="metric-label">Monthly Organic Visitors</div>
    </div>
    <div class="metric-card accent">
      <div class="metric-value">Low</div>
      <div class="metric-label">Search Visibility</div>
    </div>`;

  const keywordRows = hasRealData && seo.topKeywords.length > 0
    ? seo.topKeywords.slice(0, 6).map(k => `
        <tr>
          <td>${escHtml(k.keyword)}</td>
          <td class="pos pos-${k.position <= 10 ? "top" : k.position <= 20 ? "mid" : "low"}">#${k.position}</td>
          <td>${(k.searchVolume || 0).toLocaleString()}/mo</td>
        </tr>`).join("")
    : `<tr><td colspan="3" class="empty-row">No keyword data available — DataForSEO API key not configured.</td></tr>`;

  const biggestGap = seo?.biggestGap || `Limited search visibility for ${company} in ${location}`;

  const findings = (report.findings || []).slice(0, 4).map(f => `
    <li class="finding finding-${(f.severity || "").toLowerCase().replace(/\s+/g, "-")}">
      <span class="finding-badge">${escHtml(f.severity || "Info")}</span>
      <strong>${escHtml(f.title)}</strong>
      <p>${escHtml(f.recommendation || f.evidence || "")}</p>
    </li>`).join("") || `<li class="finding finding-medium"><strong>Website review required</strong><p>A manual review of your site will surface the most relevant opportunities.</p></li>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Website Audit Report — ${escHtml(company)}</title>
  <style>
    :root {
      --bg: #08101a;
      --surface: #0d1a2b;
      --border: rgba(152,182,255,.13);
      --text: #e8f0fc;
      --muted: #8098c0;
      --accent: #5be8b0;
      --warn: #f6a623;
      --danger: #ff6b6b;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.6;
      min-height: 100vh;
    }
    .header {
      background: linear-gradient(135deg, #0d1a2b 0%, #091528 100%);
      border-bottom: 1px solid var(--border);
      padding: 28px 24px 24px;
    }
    .header-inner {
      max-width: 760px;
      margin: 0 auto;
    }
    .brand { font-size: 12px; font-weight: 700; letter-spacing: .1em; color: var(--accent); text-transform: uppercase; margin-bottom: 12px; }
    .company-name { font-size: clamp(1.6rem, 4vw, 2.4rem); font-weight: 800; line-height: 1.2; margin-bottom: 6px; }
    .company-meta { color: var(--muted); font-size: 14px; }
    .main { max-width: 760px; margin: 32px auto; padding: 0 24px 60px; }
    .section-title { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); margin-bottom: 14px; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 40px; }
    .metric-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 20px;
      text-align: center;
    }
    .metric-card.accent { border-color: rgba(91,232,176,.22); background: rgba(91,232,176,.04); }
    .metric-value { font-size: 2rem; font-weight: 800; color: var(--text); line-height: 1; margin-bottom: 6px; }
    .metric-card.accent .metric-value { color: var(--accent); }
    .metric-label { font-size: 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
    .gap-box {
      background: rgba(246,166,35,.07);
      border: 1px solid rgba(246,166,35,.25);
      border-radius: 14px;
      padding: 18px 20px;
      margin-bottom: 40px;
    }
    .gap-box .gap-label { font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--warn); margin-bottom: 8px; }
    .gap-box p { color: var(--text); font-size: 15px; }
    .kw-table { width: 100%; border-collapse: collapse; margin-bottom: 40px; font-size: 14px; }
    .kw-table th { text-align: left; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; padding: 0 0 10px; border-bottom: 1px solid var(--border); }
    .kw-table td { padding: 12px 0; border-bottom: 1px solid rgba(152,182,255,.06); }
    .kw-table td:first-child { color: var(--text); }
    .pos { font-weight: 700; text-align: center; }
    .pos-top { color: var(--accent); }
    .pos-mid { color: var(--warn); }
    .pos-low { color: var(--danger); }
    .kw-table td:last-child { color: var(--muted); text-align: right; }
    .empty-row { color: var(--muted); text-align: center; padding: 24px 0; }
    .findings-list { list-style: none; display: grid; gap: 14px; margin-bottom: 40px; }
    .finding {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 16px 18px;
    }
    .finding-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 6px;
      margin-bottom: 8px;
      background: rgba(152,182,255,.12);
      color: var(--muted);
    }
    .finding-high .finding-badge { background: rgba(255,107,107,.12); color: var(--danger); }
    .finding-medium .finding-badge, .finding-opportunity .finding-badge { background: rgba(246,166,35,.12); color: var(--warn); }
    .finding strong { display: block; font-size: 15px; margin-bottom: 6px; }
    .finding p { font-size: 13px; color: var(--muted); }
    .cta-section {
      background: linear-gradient(135deg, rgba(91,232,176,.08), rgba(91,232,176,.02));
      border: 1px solid rgba(91,232,176,.2);
      border-radius: 20px;
      padding: 32px 28px;
      text-align: center;
    }
    .cta-section h2 { font-size: 1.4rem; margin-bottom: 10px; }
    .cta-section p { color: var(--muted); margin-bottom: 24px; font-size: 15px; }
    .cta-btn {
      display: inline-block;
      background: var(--accent);
      color: #08101a;
      font-weight: 800;
      font-size: 15px;
      padding: 14px 32px;
      border-radius: 100px;
      text-decoration: none;
      transition: opacity .15s;
    }
    .cta-btn:hover { opacity: .88; }
    .footer { text-align: center; padding: 24px; color: var(--muted); font-size: 12px; border-top: 1px solid var(--border); margin-top: 20px; }
    @media (prefers-color-scheme: light) {
      :root { --bg: #f5f8ff; --surface: #fff; --border: rgba(0,40,100,.1); --text: #0d1a2b; --muted: #5a6e8e; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-inner">
      <div class="brand">Free Website Audit Report</div>
      <h1 class="company-name">${escHtml(company)}</h1>
      <p class="company-meta">${escHtml(website)}${location ? " &nbsp;·&nbsp; " + escHtml(location) : ""}</p>
    </div>
  </div>

  <main class="main">

    <div class="section-title">Organic Search Health</div>
    <div class="metrics">
      ${metricCards}
    </div>

    <div class="gap-box">
      <div class="gap-label">Biggest Opportunity</div>
      <p>${escHtml(biggestGap)}</p>
    </div>

    ${hasRealData ? `
    <div class="section-title">Keyword Rankings</div>
    <table class="kw-table">
      <thead>
        <tr>
          <th>Keyword</th>
          <th style="text-align:center">Position</th>
          <th style="text-align:right">Search Volume</th>
        </tr>
      </thead>
      <tbody>
        ${keywordRows}
      </tbody>
    </table>` : ""}

    <div class="section-title">Issues Found</div>
    <ul class="findings-list">
      ${findings}
    </ul>

    <div class="cta-section">
      <h2>Want to fix this?</h2>
      <p>We help businesses like yours win more organic visibility and leads. No contracts, no fluff — just clear priorities and execution.</p>
      <a href="mailto:${escHtml(process.env.SMTP_USER || "hello@atlasstudios.com")}" class="cta-btn">Book a Free Call</a>
    </div>
  </main>

  <footer class="footer">
    This report was generated automatically and is intended for the recipient only.
    Data sourced from public search index. &copy; ${new Date().getFullYear()} Atlas Studios.
  </footer>
</body>
</html>`;
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 1x1 transparent PNG for open tracking
const TRACKING_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function now() {
  return Date.now();
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function cleanExpiredSessions() {
  const timestamp = now();
  for (const [token, session] of sessionStore.entries()) {
    if (session.expiresAt <= timestamp) {
      sessionStore.delete(token);
    }
  }
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) {
    return {};
  }
  return header.split(";").reduce((cookies, chunk) => {
    const [rawKey, ...rawValue] = chunk.trim().split("=");
    cookies[rawKey] = decodeURIComponent(rawValue.join("="));
    return cookies;
  }, {});
}

function createSession(username, ip) {
  const token = crypto.randomBytes(32).toString("base64url");
  const signature = crypto.createHmac("sha256", authConfig.sessionSecret).update(token).digest("base64url");
  sessionStore.set(token, { username, ip, expiresAt: now() + authConfig.sessionTtlMs });
  return `${token}.${signature}`;
}

function getSessionFromRequest(req) {
  cleanExpiredSessions();
  const cookies = parseCookies(req);
  const rawToken = cookies.outbound_forge_session;
  if (!rawToken || !rawToken.includes(".")) {
    return null;
  }

  const [token, signature] = rawToken.split(".");
  const expected = crypto.createHmac("sha256", authConfig.sessionSecret).update(token).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signature || "");
  if (expectedBuffer.length !== providedBuffer.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return null;
  }

  const session = sessionStore.get(token);
  if (!session || session.expiresAt <= now()) {
    sessionStore.delete(token);
    return null;
  }
  return { token, ...session };
}

function getRateLimitRecord(key, windowMs) {
  const timestamp = now();
  const record = rateLimitStore.get(key);
  if (!record || record.expiresAt <= timestamp) {
    const nextRecord = { count: 0, expiresAt: timestamp + windowMs };
    rateLimitStore.set(key, nextRecord);
    return nextRecord;
  }
  return record;
}

function isRateLimited(key, limit, windowMs) {
  const record = getRateLimitRecord(key, windowMs);
  record.count += 1;
  return record.count > limit;
}

function baseHeaders(extra = {}) {
  return { ...securityHeaders, ...extra };
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, baseHeaders({ "Content-Type": "application/json; charset=utf-8", ...extraHeaders }));
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html, extraHeaders = {}) {
  res.writeHead(statusCode, baseHeaders({ "Content-Type": "text/html; charset=utf-8", ...extraHeaders }));
  res.end(html);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = mimeTypes[ext] || "application/octet-stream";
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 404, { ok: false, error: "File not found" });
      return;
    }
    res.writeHead(200, baseHeaders({ "Content-Type": type }));
    res.end(content);
  });
}

function collectJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function validateSetupPayload(payload) {
  const requiredFields = ["companyName", "websiteUrl", "location", "cta", "auditMode", "painPoints", "reportRequirements"];
  return requiredFields.filter(field => {
    const value = payload[field];
    return value === undefined || value === null || value === "";
  });
}

function validateAutonomousPayload(payload) {
  const requiredFields = ["campaignName", "niche", "location", "cta", "auditMode", "painPoints", "reportRequirements"];
  return requiredFields.filter(field => {
    const value = payload[field];
    return value === undefined || value === null || value === "";
  });
}

function getPathSegments(pathname) {
  return pathname.split("/").filter(Boolean);
}

function resolveStaticPath(urlPath) {
  const requestedPath = urlPath === "/" ? "/index.html" : urlPath;
  const normalizedPath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  return path.join(rootDir, normalizedPath);
}

function sessionCookieValue(token) {
  const parts = [
    `outbound_forge_session=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${Math.floor(authConfig.sessionTtlMs / 1000)}`
  ];
  if (authConfig.secureCookies) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function clearSessionCookie() {
  const parts = ["outbound_forge_session=", "HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=0"];
  if (authConfig.secureCookies) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = requestUrl;
  const clientIp = getClientIp(req);

  if (isRateLimited(`global:${clientIp}`, 300, 5 * 60 * 1000)) {
    sendJson(res, 429, { ok: false, error: "Too many requests" });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, baseHeaders({
      "Access-Control-Allow-Origin": "self",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS"
    }));
    res.end();
    return;
  }

  // ── Public tracking routes (no auth required — email clients call these) ────

  if (req.method === "GET" && pathname.startsWith("/track/open/")) {
    const segments = getPathSegments(pathname);
    const trackingId = segments[1];
    if (trackingId) {
      recordOpen(trackingId);
    }
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Length": TRACKING_PIXEL.length
    });
    res.end(TRACKING_PIXEL);
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/track/click/")) {
    const segments = getPathSegments(pathname);
    const trackingId = segments[1];
    const targetUrl = requestUrl.searchParams.get("url") || "/";
    if (trackingId) {
      recordClick(trackingId, targetUrl);
    }
    res.writeHead(302, { "Location": targetUrl });
    res.end();
    return;
  }

  // ── Public audit report page (no auth — sent to prospects in outreach) ────

  if (req.method === "GET" && pathname.startsWith("/audit/")) {
    const segments = getPathSegments(pathname);
    const auditPageId = segments[1];
    if (!auditPageId) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    recordAuditView(auditPageId);
    const auditData = getAuditPage(auditPageId);
    if (!auditData) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!DOCTYPE html><html><body style='font-family:sans-serif;padding:2rem'><h2>Report not found</h2><p>This audit link may have expired or the ID is incorrect.</p></body></html>");
      return;
    }
    const auditHtml = buildAuditPage(auditData.report);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(auditHtml);
    return;
  }

  // ── Auth routes ───────────────────────────────────────────────────────────

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, getHealth());
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    if (isRateLimited(`login:${clientIp}`, 10, 15 * 60 * 1000)) {
      sendJson(res, 429, { ok: false, error: "Too many login attempts" });
      return;
    }

    try {
      const payload = await collectJsonBody(req);
      const usernameOk = payload.username === authConfig.username;
      const providedPassword = String(payload.password || "");
      const expectedPassword = String(authConfig.password);
      const passwordOk =
        providedPassword.length === expectedPassword.length &&
        crypto.timingSafeEqual(Buffer.from(providedPassword), Buffer.from(expectedPassword));

      if (!usernameOk || !passwordOk) {
        sendJson(res, 401, { ok: false, error: "Invalid credentials" });
        return;
      }

      const sessionToken = createSession(payload.username, clientIp);
      sendJson(res, 200, { ok: true, username: payload.username }, { "Set-Cookie": sessionCookieValue(sessionToken) });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const session = getSessionFromRequest(req);
    if (session) {
      sessionStore.delete(session.token);
    }
    sendJson(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
    return;
  }

  if (req.method === "GET" && pathname === "/api/auth/session") {
    const session = getSessionFromRequest(req);
    if (!session) {
      sendJson(res, 401, { ok: false, authenticated: false });
      return;
    }
    sendJson(res, 200, { ok: true, authenticated: true, username: session.username });
    return;
  }

  // ── Protected routes ──────────────────────────────────────────────────────

  const session = getSessionFromRequest(req);
  if (!session && pathname.startsWith("/api/")) {
    sendJson(res, 401, { ok: false, error: "Authentication required" });
    return;
  }

  if (req.method === "GET" && pathname === "/api/dashboard") {
    sendJson(res, 200, getDashboard());
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/plans/") && pathname.endsWith("/send-status")) {
    const segments = getPathSegments(pathname);
    const planId = segments[2];
    const status = getSendStatus(planId);
    if (!status) {
      sendJson(res, 404, { ok: false, error: "Plan not found" });
      return;
    }
    sendJson(res, 200, { ok: true, ...status });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/plans/")) {
    const segments = getPathSegments(pathname);
    const planId = segments[2];
    const plan = getPlanById(planId);
    if (!plan) {
      sendJson(res, 404, { ok: false, error: "Plan not found" });
      return;
    }
    sendJson(res, 200, { ok: true, plan });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/autonomous-runs/")) {
    const segments = getPathSegments(pathname);
    const runId = segments[2];
    const run = getAutonomousRunById(runId);
    if (!run) {
      sendJson(res, 404, { ok: false, error: "Autonomous run not found" });
      return;
    }
    sendJson(res, 200, { ok: true, run });
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/api/plans/") && pathname.endsWith("/send")) {
    try {
      const segments = getPathSegments(pathname);
      const planId = segments[2];
      const payload = await collectJsonBody(req);

      if (!payload.recipientEmail && !payload.to) {
        sendJson(res, 400, { ok: false, error: "recipientEmail is required" });
        return;
      }

      const plan = await scheduleSend(planId, payload);
      sendJson(res, 200, { ok: true, plan });
    } catch (error) {
      sendJson(res, error.message === "Plan not found" ? 404 : 400, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/plans/") && pathname.endsWith("/status")) {
    try {
      const segments = getPathSegments(pathname);
      const planId = segments[2];
      const payload = await collectJsonBody(req);
      const plan = updatePlanStatus(planId, payload.status);
      sendJson(res, 200, { ok: true, plan });
    } catch (error) {
      sendJson(res, error.message === "Plan not found" ? 404 : 400, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/plans/") && pathname.includes("/checklist/")) {
    try {
      const segments = getPathSegments(pathname);
      const planId = segments[2];
      const itemId = segments[4];
      const payload = await collectJsonBody(req);
      const plan = updateChecklistItem(planId, itemId, payload.completed);
      sendJson(res, 200, { ok: true, plan });
    } catch (error) {
      sendJson(res, error.message.includes("not found") ? 404 : 400, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/setup-request") {
    try {
      const payload = await collectJsonBody(req);
      const missing = validateSetupPayload(payload);
      if (missing.length > 0) {
        sendJson(res, 400, { ok: false, error: `Missing required fields: ${missing.join(", ")}` });
        return;
      }
      const result = await submitSetupRequest(payload);
      sendJson(res, 201, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/autonomous-runs") {
    try {
      const payload = await collectJsonBody(req);
      const missing = validateAutonomousPayload(payload);
      if (missing.length > 0) {
        sendJson(res, 400, { ok: false, error: `Missing required fields: ${missing.join(", ")}` });
        return;
      }
      const run = createAutonomousRun(payload);
      sendJson(res, 202, { ok: true, run });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "GET") {
    if (!session) {
      sendHtml(res, 200, loginPage);
      return;
    }

    const staticPath = resolveStaticPath(pathname);
    if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
      sendFile(res, staticPath);
      return;
    }

    sendFile(res, path.join(rootDir, "index.html"));
    return;
  }

  sendJson(res, 405, { ok: false, error: "Method not allowed" });
});

server.listen(port, () => {
  console.log(`MailOutreach AI server listening on http://localhost:${port}`);
  console.log(`Username: ${authConfig.username}`);
  if (!process.env.AUTH_PASSWORD) {
    console.log(`Generated password: ${generatedPassword}`);
    console.log("Set AUTH_PASSWORD and AUTH_SESSION_SECRET to replace temporary local credentials.");
  }
  if (!process.env.OPENAI_API_KEY) {
    console.log("Warning: OPENAI_API_KEY not set — research and classifier agents will return fallbacks.");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("Warning: ANTHROPIC_API_KEY not set — email writer will use template fallback.");
  }
});
