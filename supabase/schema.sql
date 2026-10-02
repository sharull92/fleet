-- Fleet Ops — Supabase schema.
-- Run once in Supabase Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run.

create table if not exists public.fleet_kv (
  key        text primary key,
  value      text not null,              -- JSON text exactly as the dashboard saves it
  version    integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.fleet_kv_history (
  id       bigserial primary key,
  key      text not null,
  value    text not null,
  role     text not null,
  saved_at timestamptz not null default now()
);
create index if not exists fleet_kv_history_key_id on public.fleet_kv_history (key, id desc);

create table if not exists public.fleet_login_attempts (
  ip    text primary key,
  count integer not null default 0,
  since timestamptz not null default now()
);

-- Only the server (service_role / secret key) may touch these tables.
-- RLS on with no policies = the public anon/publishable key gets nothing.
alter table public.fleet_kv             enable row level security;
alter table public.fleet_kv_history     enable row level security;
alter table public.fleet_login_attempts enable row level security;
revoke all on public.fleet_kv, public.fleet_kv_history, public.fleet_login_attempts from anon, authenticated;
grant select, insert, update, delete on public.fleet_kv, public.fleet_kv_history, public.fleet_login_attempts to service_role;
grant usage on sequence public.fleet_kv_history_id_seq to service_role;

-- Save a key atomically: bump version, record history, keep the last 50 versions.
create or replace function public.fleet_put(p_key text, p_value text, p_role text)
returns table (version integer, updated_at timestamptz)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
begin
  insert into fleet_kv as k (key, value, version, updated_at)
  values (p_key, p_value, 1, now())
  on conflict (key) do update
    set value = excluded.value, version = k.version + 1, updated_at = excluded.updated_at;

  insert into fleet_kv_history (key, value, role) values (p_key, p_value, p_role);

  delete from fleet_kv_history h
  where h.key = p_key
    and h.id not in (select h2.id from fleet_kv_history h2 where h2.key = p_key order by h2.id desc limit 50);

  return query select k.version, k.updated_at from fleet_kv k where k.key = p_key;
end;
$$;

-- Login brute-force counter (15-minute window).
create or replace function public.fleet_login_fail(p_ip text)
returns integer
language sql
set search_path = public
as $$
  insert into fleet_login_attempts as a (ip, count, since) values (p_ip, 1, now())
  on conflict (ip) do update
    set count = case when a.since < now() - interval '15 minutes' then 1 else a.count + 1 end,
        since = case when a.since < now() - interval '15 minutes' then now() else a.since end
  returning count;
$$;

create or replace function public.fleet_login_failures(p_ip text)
returns integer
language sql
set search_path = public
as $$
  select coalesce((select count from fleet_login_attempts
                   where ip = p_ip and since >= now() - interval '15 minutes'), 0);
$$;

revoke all on function public.fleet_put(text, text, text)  from public, anon, authenticated;
revoke all on function public.fleet_login_fail(text)       from public, anon, authenticated;
revoke all on function public.fleet_login_failures(text)   from public, anon, authenticated;
grant execute on function public.fleet_put(text, text, text) to service_role;
grant execute on function public.fleet_login_fail(text)      to service_role;
grant execute on function public.fleet_login_failures(text)  to service_role;
