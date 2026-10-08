/* Vercel function for /api/files/fromdrive (copy a PDF from Google Drive) — logic lives in lib/api.js. */
"use strict";
const { handleApi } = require("../../lib/api");
module.exports = (req, res) => handleApi(req, res, "/api/files/fromdrive");
