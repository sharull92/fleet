/* Vercel function for /api/login — logic lives in lib/api.js. */
"use strict";
const { handleApi } = require("../lib/api");
module.exports = (req, res) => handleApi(req, res, "/api/login");
