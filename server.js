/* Fleet Swis Group — Fleet Ops local server (Docker / VPS / development).
   Zero-dependency Node (>=22.9): serves the dashboard from ./public and the API
   from lib/api.js. Storage is SQLite on disk, or Supabase when its env vars are
   set. On Vercel, api/index.js is used instead of this file. */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { handleApi, configWarnings, getStore } = require("./lib/api");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url.pathname);
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
  serveStatic(req, res, url.pathname);
});

configWarnings().forEach(w => console.warn("⚠ " + w));
server.listen(PORT, () => console.log(`Fleet Ops running on http://localhost:${PORT}  (storage: ${getStore().name})`));
function shutdown() { server.close(() => { getStore().close?.(); process.exit(0); }); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
