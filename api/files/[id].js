/* Vercel function for /api/files/:id (uploaded PDFs) — logic lives in lib/api.js. */
"use strict";
const { handleApi } = require("../../lib/api");
module.exports = (req, res) => {
  const id = (req.query && req.query.id) || new URL(req.url, "http://localhost").pathname.split("/").pop();
  return handleApi(req, res, "/api/files/" + id);
};
// Receive the PDF as a raw stream (not parsed by Vercel).
module.exports.config = { api: { bodyParser: false } };
