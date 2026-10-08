/* Vercel function for /api/gsheet/:id (Google Sheet → xlsx) — logic lives in lib/api.js. */
"use strict";
const { handleApi } = require("../../lib/api");
module.exports = (req, res) => {
  const id = (req.query && req.query.id) || new URL(req.url, "http://localhost").pathname.split("/").pop();
  return handleApi(req, res, "/api/gsheet/" + id);
};
