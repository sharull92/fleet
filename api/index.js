/* Vercel serverless entry point. vercel.json rewrites every /api/* request here
   and passes the original sub-path as ?__path=. Static files come from ./public. */
"use strict";
const { handleApi } = require("../lib/api");

module.exports = (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const sub = url.searchParams.get("__path");
  const pathname = sub != null ? "/api/" + sub : url.pathname;
  return handleApi(req, res, pathname);
};
