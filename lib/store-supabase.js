/* Supabase (Postgres) storage via the Supabase REST API — used on Vercel, where
   the filesystem is not persistent. Needs the server-only service_role / secret
   key; tables are locked with RLS so the public key cannot read them.
   Schema: supabase/schema.sql. No client library needed — plain fetch. */
"use strict";

module.exports = function createSupabaseStore(url, key) {
  const base = url.replace(/\/+$/, "") + "/rest/v1";
  const headers = { apikey: key, "Content-Type": "application/json" };
  // Legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys must not.
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;

  async function call(method, pathname, body, extraHeaders = {}) {
    const res = await fetch(base + pathname, { method, headers: { ...headers, ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = (data && (data.message || data.hint)) || `HTTP ${res.status}`;
      throw new Error(`Supabase: ${msg}${res.status === 404 ? " (did you run supabase/schema.sql?)" : ""}`);
    }
    return data;
  }
  const rpc = (fn, args) => call("POST", `/rpc/${fn}`, args);

  return {
    name: "supabase",
    async get(k) {
      const rows = await call("GET", `/fleet_kv?key=eq.${encodeURIComponent(k)}&select=value,version,updated_at`);
      return rows.length ? rows[0] : null;
    },
    async put(k, value, role) {
      const rows = await rpc("fleet_put", { p_key: k, p_value: value, p_role: role });
      return rows[0];
    },
    async all() { return call("GET", "/fleet_kv?select=key,value,version,updated_at"); },
    async loginFailureCount(ip) { return Number(await rpc("fleet_login_failures", { p_ip: ip })) || 0; },
    async recordLoginFailure(ip) { await rpc("fleet_login_fail", { p_ip: ip }); },
    async clearLoginFailures(ip) {
      await call("DELETE", `/fleet_login_attempts?ip=eq.${encodeURIComponent(ip)}`, null, { Prefer: "return=minimal" });
    },
  };
};
