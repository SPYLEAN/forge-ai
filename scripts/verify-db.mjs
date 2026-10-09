// Verifies supabase/schema.sql against real Postgres (PGlite, in-process).
// Emulates Supabase's roles, auth.uid() and default grants, then attacks the policies.
// Run: npm run verify:db
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
};
const denied = async (sql, params, label) => {
  try {
    const r = await db.query(sql, params);
    // Some RLS denials are silent (0 rows affected) rather than errors.
    ok(r.affectedRows === 0 && r.rows.length === 0, `${label} (silently 0 rows)`);
  } catch (e) {
    ok(true, `${label} (${e.message.split("\n")[0]})`);
  }
};

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

async function as(role, userId) {
  await db.exec(`reset role`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  if (role !== "postgres") await db.exec(`set role ${role}`);
}

// --- Supabase-like stub -----------------------------------------------------
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  -- Supabase's defaults: every new public table is fully granted to these roles.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`);
await db.exec(readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8"));
await db.exec(`insert into auth.users (id, email) values ('${A}','a@x.test'),('${B}','b@x.test'),('${C}','c@x.test')`);

ok((await db.query(`select count(*)::int n from public.profiles`)).rows[0].n === 3, "profiles auto-created for new users");

// --- Seed each user's data as that user -------------------------------------
const ids = {};
for (const [u, tag] of [[A, "a"], [B, "b"]]) {
  await as("authenticated", u);
  const p = (await db.query(
    `insert into public.intelligence_profiles (user_id, name) values ($1, $2) returning id`, [u, `P-${tag}`])).rows[0].id;
  const m = (await db.query(
    `insert into public.missions (user_id, profile_id, brief, mode, provider) values ($1,$2,'brief','compact','cloudflare') returning id`,
    [u, p])).rows[0].id;
  await db.query(`insert into public.mission_outputs (user_id, mission_id, role, content) values ($1,$2,'architect','plan')`, [u, m]);
  await db.query(`insert into public.lessons (user_id, profile_id, mission_id, text, source) values ($1,$2,$3,'lesson','manual')`, [u, p, m]);
  ids[tag] = { p, m };
}
await as("service_role");
await db.query(`insert into public.daily_usage (user_id, provider, ip_hash, status) values ($1,'cloudflare','ipB','succeeded')`, [B]);

// --- Isolation: A cannot see or touch B ----------------------------------------
await as("authenticated", A);
for (const t of ["profiles", "intelligence_profiles", "missions", "mission_outputs", "lessons", "daily_usage"]) {
  const r = await db.query(`select count(*)::int n, count(*) filter (where user_id <> $1)::int foreign from public.${t}`, [A]);
  ok(r.rows[0].foreign === 0, `A reads no other user's rows in ${t} (sees ${r.rows[0].n} own)`);
}
await denied(`update public.missions set brief='pwned' where id=$1 returning id`, [ids.b.m], "A cannot update B's mission");
await denied(`delete from public.lessons where profile_id=$1 returning id`, [ids.b.p], "A cannot delete B's lessons");
await denied(`insert into public.missions (user_id, profile_id, brief, mode, provider) values ($1,$2,'x','compact','cf') returning id`, [B, ids.b.p], "A cannot insert a mission as B");
await denied(`insert into public.missions (user_id, profile_id, brief, mode, provider) values ($1,$2,'x','compact','cf') returning id`, [A, ids.b.p], "A cannot attach a mission to B's partner");
await denied(`insert into public.mission_outputs (user_id, mission_id, role, content) values ($1,$2,'critic','x') returning id`, [A, ids.b.m], "A cannot write outputs into B's mission");
await denied(`insert into public.daily_usage (user_id, provider, ip_hash) values ($1,'cf','x') returning id`, [A], "A cannot insert usage rows");
await denied(`delete from public.daily_usage returning id`, [], "A cannot delete usage rows (reset own quota)");
await denied(`select * from public.claim_live_mission($1,'ip','cf',99,99,99)`, [A], "A cannot call claim_live_mission with own limits");

// --- Anonymous visitors get nothing ---------------------------------------------
await as("anon");
for (const t of ["profiles", "missions", "lessons", "daily_usage"]) {
  await denied(`select * from public.${t}`, [], `anon cannot read ${t}`);
}

// --- Quota function (server / service role) ------------------------------------
await as("service_role");
const claim = async (u, ip, userLimit, ipLimit, globalLimit) =>
  (await db.query(`select * from public.claim_live_mission($1,$2,'cloudflare',$3,$4,$5)`, [u, ip, userLimit, ipLimit, globalLimit])).rows[0];

// B already has 1 usage today. Global limit 3, user limit 1, IP limit 2.
let r = await claim(A, "ipA", 1, 2, 3);
ok(r.outcome === "ok" && r.usage_id, "A's first live mission is claimed");
r = await claim(A, "ipA", 1, 2, 3);
ok(r.outcome === "user_limit" && r.usage_id === null, "A's second live mission today -> user_limit");
r = await claim(B, "ipB", 1, 2, 3);
ok(r.outcome === "user_limit", "B (already used 1) -> user_limit");
r = await claim(C, "ipA", 5, 1, 3);
ok(r.outcome === "ip_limit", "C on A's IP with ip limit 1 -> ip_limit");
r = await claim(C, "ipC", 5, 5, 3);
ok(r.outcome === "ok", "C claims the last global slot (3/3)");
r = await claim(C, "ipC", 5, 5, 3);
ok(r.outcome === "global_limit", "global daily capacity exhausted -> global_limit");
const reserved = (await db.query(`select count(*)::int n from public.daily_usage where status='reserved'`)).rows[0].n;
ok(reserved === 2, `only successful claims create usage rows (${reserved} reserved)`);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll database checks passed.");
process.exit(failures ? 1 : 0);
