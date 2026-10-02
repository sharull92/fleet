/* Fleet Ops API — shared by the local server (server.js) and the Vercel
   functions in api/. Picks its storage from the environment:
   Supabase when SUPABASE_URL + a service key are set, otherwise SQLite on disk. */
"use strict";
const path = require("node:path");
const crypto = require("node:crypto");

const ON_VERCEL = !!process.env.VERCEL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (ON_VERCEL ? null : "komatsu2026");
const SESSION_SECRET = process.env.SESSION_SECRET || (ON_VERCEL ? null : crypto.randomBytes(32).toString("hex"));
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
// Vercel caps request bodies at 4.5 MB.
const MAX_BODY_BYTES = ON_VERCEL ? 4.5 * 1024 * 1024 : 20 * 1024 * 1024;

/* Keys the dashboard is allowed to store. Admin-only keys reject writes from
   non-admin sessions; the rest are written by drivers / branch staff too. */
const STORAGE_KEYS = {
  fleetComplianceRegister_v2: { adminOnly: false },
  fleetTickets_v1: { adminOnly: false },
  fleetHiringRecords_v1: { adminOnly: false },
  fleetCostingData_v1: { adminOnly: false },
  fleetUtilizationData_v1: { adminOnly: true },
  fleetTargetConfig_v1: { adminOnly: true },
  fleetContactsConfig_v1: { adminOnly: true },
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

let store = null;
function getStore() {
  if (store) return store;
  if (SUPABASE_URL && SUPABASE_KEY) {
    store = require("./store-supabase")(SUPABASE_URL, SUPABASE_KEY);
  } else if (!ON_VERCEL) {
    store = require("./store-sqlite")(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
  }
  return store;
}

function configWarnings() {
  const w = [];
  if (!process.env.ADMIN_PASSWORD) w.push(ON_VERCEL ? "ADMIN_PASSWORD not set — admin login disabled." : "ADMIN_PASSWORD not set — using the default prototype password. Set it before going live.");
  if (!process.env.SESSION_SECRET) w.push(ON_VERCEL ? "SESSION_SECRET not set — admin login disabled." : "SESSION_SECRET not set — admin sessions reset whenever the server restarts.");
  if (ON_VERCEL && !(SUPABASE_URL && SUPABASE_KEY)) w.push("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — data cannot be saved.");
  return w;
}

/* ---------- Sessions (signed cookie, stateless) ---------- */
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verify(token) {
  if (!SESSION_SECRET || !token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    return payload.exp > Date.now() ? payload : null;
  } catch { return null; }
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim().split("=")).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
}
function getRole(req) {
  const s = verify(parseCookies(req).fleet_session);
  return s ? s.role : null;
}
function sessionCookie(req, value, maxAgeSec) {
  const secure = req.headers["x-forwarded-proto"] === "https" || (req.socket && req.socket.encrypted) ? "; Secure" : "";
  return `fleet_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${secure}`;
}
function passwordMatches(pw) {
  const a = crypto.createHash("sha256").update(String(pw)).digest();
  const b = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  return (ON_VERCEL && fwd ? String(fwd).split(",")[0].trim() : null) || req.socket?.remoteAddress || "unknown";
}

/* ---------- HTTP helpers ---------- */
function sendJson(res, status, obj, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(obj));
}
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function readBody(req) {
  // Vercel's Node runtime pre-parses JSON bodies onto req.body.
  if (req.body !== undefined) {
    if (typeof req.body === "string") { try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.reject(httpError(400, "Invalid JSON")); } }
    if (Buffer.isBuffer(req.body)) { try { return Promise.resolve(JSON.parse(req.body.toString())); } catch { return Promise.reject(httpError(400, "Invalid JSON")); } }
    return Promise.resolve(req.body || {});
  }
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(httpError(413, "Payload too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch { reject(httpError(400, "Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

/* ---------- Routes ---------- */
async function route(req, res, pathname) {
  const role = getRole(req);
  const p = pathname;

  if (p === "/api/health") {
    return sendJson(res, 200, { ok: configWarnings().length === 0, storage: getStore()?.name || "none", warnings: configWarnings() });
  }

  if (p === "/api/session" && req.method === "GET") return sendJson(res, 200, { role });

  if (p === "/api/login" && req.method === "POST") {
    if (!ADMIN_PASSWORD || !SESSION_SECRET) return sendJson(res, 503, { error: "Admin login not configured on the server (ADMIN_PASSWORD / SESSION_SECRET)." });
    const s = getStore();
    if (!s) return sendJson(res, 503, { error: "Database not connected." });
    const ip = clientIp(req);
    if (await s.loginFailureCount(ip) >= 10) return sendJson(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
    const { password } = await readBody(req);
    if (!password || !passwordMatches(password)) {
      await s.recordLoginFailure(ip);
      return sendJson(res, 401, { error: "Password admin salah." });
    }
    await s.clearLoginFailures(ip);
    const token = sign({ role: "admin", exp: Date.now() + SESSION_TTL_MS });
    return sendJson(res, 200, { role: "admin" }, { "Set-Cookie": sessionCookie(req, token, SESSION_TTL_MS / 1000) });
  }

  if (p === "/api/logout" && req.method === "POST") {
    return sendJson(res, 200, { role: null }, { "Set-Cookie": sessionCookie(req, "", 0) });
  }

  // Full backup of every stored key (admin only).
  if (p === "/api/export" && req.method === "GET") {
    if (role !== "admin") return sendJson(res, 403, { error: "Admin sahaja." });
    const s = getStore();
    if (!s) return sendJson(res, 503, { error: "Database not connected." });
    const out = {};
    for (const r of await s.all()) out[r.key] = { value: JSON.parse(r.value), version: r.version, updated_at: r.updated_at };
    const stamp = new Date().toISOString().slice(0, 10);
    return sendJson(res, 200, out, { "Content-Disposition": `attachment; filename="fleet-backup-${stamp}.json"` });
  }

  const m = p.match(/^\/api\/storage\/([A-Za-z0-9_]+)$/);
  if (m) {
    const key = m[1];
    const meta = STORAGE_KEYS[key];
    if (!meta) return sendJson(res, 404, { error: "Unknown key" });
    const s = getStore();
    if (!s) return sendJson(res, 503, { error: "Database not connected — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." });

    if (req.method === "GET") {
      const row = await s.get(key);
      if (!row) return sendJson(res, 200, { key, value: null });
      return sendJson(res, 200, { key, value: row.value, version: row.version, updated_at: row.updated_at });
    }
    if (req.method === "PUT") {
      if (meta.adminOnly && role !== "admin") return sendJson(res, 403, { error: "Admin sahaja boleh simpan data ini." });
      const { value } = await readBody(req);
      if (typeof value !== "string") return sendJson(res, 400, { error: "value must be a string" });
      try { JSON.parse(value); } catch { return sendJson(res, 400, { error: "value must be JSON text" }); }
      const saved = await s.put(key, value, role || "public");
      return sendJson(res, 200, { key, version: saved.version, updated_at: saved.updated_at });
    }
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  return sendJson(res, 404, { error: "Not found", path: p });
}

/* Entry point for /api/* requests. */
async function handleApi(req, res, pathname) {
  try {
    // CSRF guard: state-changing API calls must come from this app's own pages.
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-requested-with"] !== "fleet-app") {
      return sendJson(res, 403, { error: "Forbidden" });
    }
    await route(req, res, pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, e.status || 500, { error: e.status ? e.message : "Server error" });
  }
}

module.exports = { handleApi, configWarnings, getStore };
