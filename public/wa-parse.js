/* Parse a job request pasted from a WhatsApp group into Log Job Request fields.

   Expected shape (labels in any case/order, WhatsApp *bold* is fine):
     LORI TIPPER
     TARIKH:2/10/26
     MASA:10.00
     TNB:Navin
     COMPANY:Akli
     SV:Yus'ran 01128278075
     LOKASI:jln pjs 2d/1
     LOAD: 3 pasir 3 Crusher run

   The first line without a label is the unit. Labels the form has no field for
   (e.g. TNB) are kept by adding them to Project, so no detail is lost. A Google
   Maps link or "lat, lng" anywhere in the paste is added to Location. */
(function (root) {
  "use strict";

  const FIELD_KEYS = {
    unit:    ["unit", "item", "kenderaan", "jentera", "machine", "mesin", "vehicle"],
    tarikh:  ["tarikh", "trkh", "tkh", "date", "tgl", "tanggal"],
    masa:    ["masa", "time", "jam", "waktu"],
    company: ["company", "syarikat", "co", "kontraktor", "contractor", "client"],
    project: ["project", "projek", "proj", "job", "kerja", "scope", "skop"],
    tempat:  ["lokasi", "location", "loc", "tempat", "alamat", "address", "site", "tapak"],
    load:    ["load", "muatan", "bawa", "material", "bahan", "barang"],
    sv:      ["sv", "supervisor", "spv", "penyelia", "pic", "contact person", "hubungi", "nama"],
    phone:   ["phone", "tel", "telefon", "no tel", "no telefon", "hp", "no hp", "handphone", "contact", "no"],
    branch:  ["branch", "cawangan"],
  };
  const KEY_TO_FIELD = {};
  for (const [field, keys] of Object.entries(FIELD_KEYS)) keys.forEach(k => { KEY_TO_FIELD[k] = field; });

  const MONTHS = {
    jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mac: 3, mar: 3, march: 3,
    apr: 4, april: 4, mei: 5, may: 5, jun: 6, june: 6, jul: 7, julai: 7, july: 7,
    ogos: 8, ogo: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, october: 10,
    nov: 11, november: 11, dis: 12, dec: 12, disember: 12, december: 12,
  };
  const PHONE_RE = /(?:\+?6?0)?1\d[\s-]?\d{3,4}[\s-]?\d{3,4}/;

  const pad = n => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const validDate = (y, m, d) => { const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d; };

  function cleanLine(line) {
    return line
      .replace(/[​-‏‪-‮⁠﻿]/g, "")       // invisible marks WhatsApp adds
      .replace(/^\s*\[\d{1,2}[:.]\d{2}(?:\s?[ap]\.?m\.?)?,\s*\d{1,2}\/\d{1,2}\/\d{2,4}\]\s*[^:]{1,40}:\s*/i, "") // "[15:23, 02/10/2026] Name: "
      .replace(/[*_~`]/g, "")                                          // *bold* _italic_ ~strike~
      .replace(/^\s*[-•▪►➤✅☑️📍🚛🚚]+\s*/u, "")                           // bullets / emoji prefixes
      .trim();
  }

  function parseDate(s, today) {
    s = s.trim().toLowerCase();
    if (!s) return null;
    const base = today ? new Date(today) : new Date();
    const rel = { "hari ini": 0, "harini": 0, "today": 0, "esok": 1, "tomorrow": 1, "lusa": 2 };
    for (const [w, add] of Object.entries(rel)) {
      if (s.includes(w)) { const t = new Date(base); t.setDate(t.getDate() + add); return iso(t.getFullYear(), t.getMonth() + 1, t.getDate()); }
    }
    let m = s.match(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);                 // 2026-10-02
    if (m) { const [y, mo, d] = [+m[1], +m[2], +m[3]]; return validDate(y, mo, d) ? iso(y, mo, d) : null; }
    m = s.match(/(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?/);               // 2/10/26, 2.10.2026, 2/10
    if (m) {
      const d = +m[1], mo = +m[2];
      let y = m[3] ? +m[3] : base.getFullYear();
      if (y < 100) y += 2000;
      return validDate(y, mo, d) ? iso(y, mo, d) : null;
    }
    m = s.match(/(\d{1,2})\s*([a-z]{3,9})\.?\s*(\d{2,4})?/);                    // 2 Okt 2026
    if (m && MONTHS[m[2]]) {
      let y = m[3] ? +m[3] : base.getFullYear();
      if (y < 100) y += 2000;
      return validDate(y, MONTHS[m[2]], +m[1]) ? iso(y, MONTHS[m[2]], +m[1]) : null;
    }
    return null;
  }

  function parseTime(s) {
    s = s.trim().toLowerCase();
    if (!s) return null;
    let m = s.match(/^(\d{2})(\d{2})\s*(?:h|hrs|jam)?$/);                       // 1400 / 0830
    let h, min = 0, suffix = "";
    if (m) { h = +m[1]; min = +m[2]; }
    else {
      m = s.match(/(\d{1,2})(?:\s*[.:]\s*(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|pagi|ptg|petang|tengah\s*hari|tghari|tgh|malam|mlm)?/);
      if (!m) return null;
      h = +m[1]; min = m[2] ? +m[2] : 0; suffix = (m[3] || "").replace(/[.\s]/g, "");
    }
    if (/^(pm|ptg|petang|malam|mlm)$/.test(suffix) && h < 12) h += 12;
    if (/^(tengahhari|tghari|tgh)$/.test(suffix) && h < 11) h += 12;
    if (/^(am|pagi)$/.test(suffix) && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return `${pad(h)}:${pad(min)}`;
  }

  function splitNamePhone(v) {
    const m = v.match(PHONE_RE);
    if (!m) return { name: v.trim(), phone: "" };
    const name = (v.slice(0, m.index) + " " + v.slice(m.index + m[0].length)).replace(/[\s,;:()\-–—/]+$/, "").replace(/^[\s,;:()\-–—/]+/, "").replace(/\s{2,}/g, " ").trim();
    return { name, phone: m[0].replace(/[\s-]/g, "") };
  }

  function mapsLink(text) {
    const url = text.match(/https?:\/\/[^\s]*(?:maps\.google|google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|waze\.com)[^\s]*/i);
    if (url) return url[0];
    const ll = text.match(/(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/);
    if (ll) return `https://maps.google.com/?q=${ll[1]},${ll[2]}`;
    return "";
  }

  /* Returns { fields: {unit, tarikh(yyyy-mm-dd), masa(HH:MM), company, project, tempat, load, sv, phone, branch},
               extras: ["TNB: Navin", ...], filled: [fieldNames] } */
  function parseWhatsAppJob(text, opts = {}) {
    const fields = {};
    const extras = [];
    const branches = (opts.branches || []).map(b => String(b));
    const lines = String(text || "").split(/\r?\n/).map(cleanLine).filter(Boolean)
      .filter(l => !/^(forwarded|diteruskan|dimajukan)$/i.test(l));

    for (const line of lines) {
      const m = line.match(/^([A-Za-z][A-Za-z .\/']{0,24}?)\s*[:：=]\s*(.*)$/) ||
                line.match(/^([A-Za-z][A-Za-z .\/']{0,24}?)\s+[-–]\s+(.*)$/);
      if (m) {
        const keyRaw = m[1].trim(), key = keyRaw.toLowerCase().replace(/\.$/, "").replace(/\s+/g, " ");
        const value = m[2].trim();
        const field = KEY_TO_FIELD[key] || KEY_TO_FIELD[key.replace(/\./g, "")];
        if (!value) continue;
        if (!field) {
          // "https: //..." etc. are not labels
          if (/^https?$/i.test(key)) { if (!fields.unit && !mapsLink(line)) fields.unit = line; continue; }
          extras.push(`${keyRaw.toUpperCase()}: ${value}`); continue;
        }
        if (field === "sv") {
          const { name, phone } = splitNamePhone(value);
          if (name) fields.sv = name;
          if (phone && !fields.phone) fields.phone = phone;
        } else if (field === "phone") {
          const pm = value.match(PHONE_RE);
          fields.phone = pm ? pm[0].replace(/[\s-]/g, "") : value;
        } else if (field === "tarikh") {
          const d = parseDate(value, opts.today);
          if (d) fields.tarikh = d; else extras.push(`${keyRaw.toUpperCase()}: ${value}`);
        } else if (field === "masa") {
          const t = parseTime(value);
          if (t) fields.masa = t; else extras.push(`${keyRaw.toUpperCase()}: ${value}`);
        } else if (field === "branch") {
          const hit = branches.find(b => b.toLowerCase() === value.toLowerCase());
          if (hit) fields.branch = hit; else extras.push(`${keyRaw.toUpperCase()}: ${value}`);
        } else {
          fields[field] = value;
        }
      } else if (!fields.unit && !mapsLink(line)) {
        fields.unit = line;                                   // first unlabeled line = unit, e.g. "LORI TIPPER"
      }
    }

    const link = mapsLink(String(text || ""));
    if (link && !(fields.tempat || "").includes(link)) fields.tempat = fields.tempat ? `${fields.tempat} · ${link}` : link;

    if (extras.length) {
      const extra = extras.join(" · ");
      fields.project = fields.project ? `${fields.project} (${extra})` : extra;
    }
    return { fields, extras, filled: Object.keys(fields) };
  }

  const api = { parseWhatsAppJob, parseDate, parseTime };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.fleetWaParse = api;
})(typeof window !== "undefined" ? window : globalThis);
