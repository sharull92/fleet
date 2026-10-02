/* Vercel function for /api/logout — logic lives in lib/api.js. */
"use strict";
const { handleApi } = require("../lib/api");
module.exports = (req, res) => handleApi(req, res, "/api/logout");
