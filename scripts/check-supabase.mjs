// Checks that the Supabase project in .env.local is reachable and set up for FORGE AI.
// Usage: npm run check:supabase
// It creates one throwaway anonymous user to test guest sign-in, then deletes it.
import { readFileSync } from "node:fs";
import { lookup } from "node:dns/promises";

const env = {};
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  console.log("FAIL  .env.local not found. Copy .env.example to .env.local first.");
  process.exit(1);
}

let failures = 0;
const ok = (cond, label, fix = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) {
    failures++;
    if (fix) console.log(`      → ${fix}`);
  }
  return cond;
};
const done = () => {
  console.log(failures ? `\n${failures} problem(s) found.` : "\nSupabase is ready.");
  process.exit(failures ? 1 : 0);
};

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = env.SUPABASE_SERVICE_ROLE_KEY;
const where = "Supabase dashboard → Project Settings → API (or Data API / API Keys)";

ok(Boolean(url), "NEXT_PUBLIC_SUPABASE_URL is set", `Copy the Project URL from ${where}`);
ok(Boolean(anon), "NEXT_PUBLIC_SUPABASE_ANON_KEY is set", `Copy the publishable (anon) key from ${where}`);
ok(Boolean(secret), "SUPABASE_SERVICE_ROLE_KEY is set", `Copy the secret (service_role) key from ${where}`);
if (!url || !anon || !secret) done();

let host;
try {
  host = new URL(url).host;
} catch {
  ok(false, `Project URL is a valid URL (${url})`, "It should look like https://<project-ref>.supabase.co");
  done();
}
try {
  await lookup(host);
  ok(true, `${host} exists`);
} catch {
  ok(
    false,
    `${host} exists`,
    `That project doesn't exist. Check for a typo, or that the project wasn't deleted, then copy the Project URL again from ${where}`,
  );
  done();
}

const call = (path, key, init = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });

const health = await call("/auth/v1/settings", anon).catch((e) => e);
if (!ok(health instanceof Response && health.ok, "Publishable key is accepted", "The key doesn't belong to this project. Copy it again.")) done();

// The OpenAPI description lists every table and function the secret key can see.
const spec = await call("/rest/v1/", secret).then((r) => (r.ok ? r.json() : null)).catch(() => null);
if (ok(Boolean(spec), "Secret key is accepted", "Copy the secret (service_role) key again.")) {
  const paths = Object.keys(spec.paths ?? {});
  const tables = ["profiles", "intelligence_profiles", "missions", "mission_outputs", "lessons", "daily_usage"];
  const missing = tables.filter((t) => !paths.includes(`/${t}`));
  ok(missing.length === 0, "All six tables exist", `Run supabase/schema.sql in the SQL Editor (missing: ${missing.join(", ")})`);
  ok(paths.includes("/rpc/claim_live_mission"), "Quota function claim_live_mission exists", "Run supabase/schema.sql in the SQL Editor");
}

const signup = await call("/auth/v1/signup", anon, { method: "POST", body: JSON.stringify({}) });
const body = await signup.json().catch(() => ({}));
if (signup.ok && body.user?.id) {
  ok(true, "Anonymous sign-ins are on (one-click Get started works)");
  await call(`/auth/v1/admin/users/${body.user.id}`, secret, { method: "DELETE" }).catch(() => {});
} else {
  const disabled = JSON.stringify(body).includes("anonymous_provider_disabled");
  ok(
    false,
    "Anonymous sign-ins are on",
    disabled
      ? "Authentication → Sign In / Providers → turn on 'Allow anonymous sign-ins', then Save"
      : `Supabase said: ${signup.status} ${body.msg ?? body.message ?? body.error_code ?? ""}`,
  );
}
done();
