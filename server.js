/* Fleet Swis Group — Fleet Ops app server.
   Zero-dependency Node (>=22.9) server: serves the dashboard from ./public and
   stores shared data in SQLite (node:sqlite) so every staff member sees the same
   records. Admin login is checked here on the server, not in the browser. */
"use strict";
process.removeAllListeners("warning"); // silence node:sqlite ExperimentalWarning
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "komatsu2026";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 20 * 1024 * 1024;

if (!process.env.ADMIN_PASSWORD) console.warn("⚠ ADMIN_PASSWORD not set — using the default prototype password. Set it before going live.");
if (!process.env.SESSION_SECRET) console.warn("⚠ SESSION_SECRET not set — admin sessions reset whenever the server restarts.");

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

/* ---------- Database ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "fleet.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS kv_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    role TEXT NOT NULL,
    saved_at TEXT NOT NULL
  );
`);
const stmtGet = db.prepare("SELECT value, version, updated_at FROM kv WHERE key = ?");
const stmtAll = db.prepare("SELECT key, value, version, updated_at FROM kv");
const stmtUpsert = db.prepare(`
  INSERT INTO kv (key, value, version, updated_at) VALUES (?, ?, 1, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = kv.version + 1, updated_at = excluded.updated_at
`);
const stmtHistory = db.prepare("INSERT INTO kv_history (key, value, role, saved_at) VALUES (?, ?, ?, ?)");
// Keep the last 50 saved versions of each key so a bad save can be rolled back.
const stmtPrune = db.prepare(`
  DELETE FROM kv_history WHERE key = ? AND id NOT IN (
    SELECT id FROM kv_history WHERE key = ? ORDER BY id DESC LIMIT 50
  )
`);

/* ---------- Sessions (signed cookie, stateless) ---------- */
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verify(token) {
  if (!token || !token.includes(".")) return null;
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
  const secure = req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted ? "; Secure" : "";
  return `fleet_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${secure}`;
}
function passwordMatches(pw) {
  const a = crypto.createHash("sha256").update(String(pw)).digest();
  const b = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
// Basic brute-force guard on the login endpoint.
const loginAttempts = new Map();
function loginBlocked(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, since: now };
  if (now - rec.since > 15 * 60 * 1000) { rec.count = 0; rec.since = now; }
  loginAttempts.set(ip, rec);
  return rec.count >= 10;
}

/* ---------- HTTP helpers ---------- */
function sendJson(res, status, obj, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error("Payload too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon",
};
function serveStatic(req, res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return; }
    const ext = path.extname(file);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" || rel === "sw.js" ? "no-cache" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(buf);
  });
}

/* ---------- API ---------- */
async function handleApi(req, res, url) {
  const role = getRole(req);
  const p = url.pathname;

  if (p === "/api/health") return sendJson(res, 200, { ok: true });

  if (p === "/api/session" && req.method === "GET") return sendJson(res, 200, { role });

  if (p === "/api/login" && req.method === "POST") {
    const ip = req.socket.remoteAddress;
    if (loginBlocked(ip)) return sendJson(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
    const { password } = await readBody(req);
    if (!password || !passwordMatches(password)) {
      loginAttempts.get(ip).count++;
      return sendJson(res, 401, { error: "Password admin salah." });
    }
    loginAttempts.delete(ip);
    const token = sign({ role: "admin", exp: Date.now() + SESSION_TTL_MS });
    return sendJson(res, 200, { role: "admin" }, { "Set-Cookie": sessionCookie(req, token, SESSION_TTL_MS / 1000) });
  }

  if (p === "/api/logout" && req.method === "POST") {
    return sendJson(res, 200, { role: null }, { "Set-Cookie": sessionCookie(req, "", 0) });
  }

  // Full backup of every stored key (admin only).
  if (p === "/api/export" && req.method === "GET") {
    if (role !== "admin") return sendJson(res, 403, { error: "Admin sahaja." });
    const out = {};
    for (const r of stmtAll.all()) out[r.key] = { value: JSON.parse(r.value), version: r.version, updated_at: r.updated_at };
    const stamp = new Date().toISOString().slice(0, 10);
    return sendJson(res, 200, out, { "Content-Disposition": `attachment; filename="fleet-backup-${stamp}.json"` });
  }

  const m = p.match(/^\/api\/storage\/([A-Za-z0-9_]+)$/);
  if (m) {
    const key = m[1];
    const meta = STORAGE_KEYS[key];
    if (!meta) return sendJson(res, 404, { error: "Unknown key" });

    if (req.method === "GET") {
      const row = stmtGet.get(key);
      if (!row) return sendJson(res, 200, { key, value: null });
      return sendJson(res, 200, { key, value: row.value, version: row.version, updated_at: row.updated_at });
    }
    if (req.method === "PUT") {
      if (meta.adminOnly && role !== "admin") return sendJson(res, 403, { error: "Admin sahaja boleh simpan data ini." });
      const { value } = await readBody(req);
      if (typeof value !== "string") return sendJson(res, 400, { error: "value must be a string" });
      try { JSON.parse(value); } catch { return sendJson(res, 400, { error: "value must be JSON text" }); }
      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        stmtUpsert.run(key, value, now);
        stmtHistory.run(key, value, role || "public", now);
        stmtPrune.run(key, key);
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
      const row = stmtGet.get(key);
      return sendJson(res, 200, { key, version: row.version, updated_at: row.updated_at });
    }
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  return sendJson(res, 404, { error: "Not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) {
      // CSRF guard: state-changing API calls must come from this app's own pages.
      if (req.method !== "GET" && req.headers["x-requested-with"] !== "fleet-app") {
        return sendJson(res, 403, { error: "Forbidden" });
      }
      return await handleApi(req, res, url);
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
    serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    sendJson(res, e.status || 500, { error: e.status ? e.message : "Server error" });
  }
});

server.listen(PORT, () => console.log(`Fleet Ops running on http://localhost:${PORT}  (data: ${DATA_DIR})`));
function shutdown() { server.close(() => { db.close(); process.exit(0); }); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
