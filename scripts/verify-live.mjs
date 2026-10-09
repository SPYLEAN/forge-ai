// End-to-end checks of the zero-spend guards against a running production server
// (`next start`) in local mode, with the mock Cloudflare API on :8787.
// Usage: node scripts/verify-live.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://127.0.0.1:3100";
const MOCK = "http://127.0.0.1:8787";
const TOKEN = "XXXX.DUMMY.TOKEN.XXXX"; // Turnstile's documented test token

let failures = 0;
const ok = (cond, label, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  [${detail}]` : ""}`);
  if (!cond) failures++;
};

const mock = {
  mode: (m) => fetch(`${MOCK}/__mode`, { method: "POST", body: JSON.stringify({ mode: m }) }),
  stats: () => fetch(`${MOCK}/__stats`).then((r) => r.json()),
};

async function signIn(name) {
  const res = await fetch(`${BASE}/api/auth/dev`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  const headers = { cookie, "content-type": "application/json" };
  await fetch(`${BASE}/api/partner`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ name: `P-${name}`, personality: "", standards: "" }),
  });
  return headers;
}

async function mission(headers, extra = {}) {
  const res = await fetch(`${BASE}/api/missions`, {
    method: "POST",
    headers: headers ?? { "content-type": "application/json" },
    body: JSON.stringify({ brief: "Add rate limiting to the contact API route.", mode: "compact", turnstileToken: TOKEN, ...extra }),
  });
  const text = await res.text();
  const events = res.headers.get("content-type")?.includes("ndjson")
    ? text.trim().split("\n").map((l) => JSON.parse(l))
    : [];
  let json = null;
  try {
    json = events.length ? null : JSON.parse(text);
  } catch {}
  return { status: res.status, events, json };
}

// --- Anonymous visitors ----------------------------------------------------
let usage = await fetch(`${BASE}/api/usage`).then((r) => r.json());
ok(usage.signedIn === false && usage.compact.available === false, "anonymous: live AI not offered", usage.compact.reason);
let r = await mission(null);
ok(r.status === 401 && r.json?.code === "auth_required", "anonymous: POST /api/missions -> 401", `${r.status}`);
ok((await fetch(`${BASE}/api/partner`)).status === 401, "anonymous: cannot read partner data -> 401");
ok((await mock.stats()).requests === 0, "anonymous: zero provider requests made");

// --- Authenticated: one live mission per day -----------------------------------
const alice = await signIn("alice");
await mock.mode("ok");
r = await mission(alice);
const done = r.events.find((e) => e.type === "done");
ok(r.status === 200 && done?.mission.status === "awaiting_review", "alice: first live mission succeeds", `status ${r.status}`);
ok(
  ["architect", "builder", "critic", "witness"].every((a) => r.events.some((e) => e.type === "section" && e.agent === a)),
  "alice: structured output has all four sections",
);
ok(done?.mission.gates?.correctness === "fail" && done?.mission.provider === "cloudflare", "alice: gates parsed, provider recorded");
let s = await mock.stats();
ok(s.requests === 1, "alice: exactly one provider request", `requests=${s.requests}`);
ok(s.lastBody?.max_tokens === 1200 && s.lastBody.messages.length === 2, "request capped at 1,200 output tokens, single prompt", `max_tokens=${s.lastBody?.max_tokens}`);
ok(s.lastAuth === "present", "provider key sent server-to-server only");
const aliceMissionId = done?.mission.id;

r = await mission(alice);
ok(r.status === 429 && r.json?.code === "user_limit" && r.json?.fallback === "demo", "alice: second live mission -> 429 user_limit, offers demo", `${r.status} ${r.json?.code}`);
ok((await mock.stats()).requests === 1, "alice: the 429 made no provider request");

// --- Input limits / Full Swarm (rejected before quota) -------------------------
const erin = await signIn("erin");
r = await mission(erin, { brief: "x".repeat(6001) });
ok(r.status === 400 && r.json?.code === "too_long", "brief over 6,000 chars -> 400", `${r.status}`);
r = await mission(erin, { mode: "full" });
ok(r.status === 403 && r.json?.code === "full_disabled", "Full Swarm publicly disabled -> 403", `${r.status}`);
r = await mission(erin, { turnstileToken: undefined });
ok(r.status === 403 && r.json?.code === "turnstile_failed", "missing Turnstile token -> 403 before any quota use", `${r.status}`);

// --- Provider failure: no retry, still counted ---------------------------------
const bob = await signIn("bob");
await mock.mode("error");
const before = (await mock.stats()).requests;
r = await mission(bob);
const err = r.events.find((e) => e.type === "error");
ok(err && err.code === "provider_error", "bob: provider failure reported", err?.message);
ok((await mock.stats()).requests === before + 1, "bob: provider failure triggered no retry (1 request)", `delta=${(await mock.stats()).requests - before}`);
r = await mission(bob);
ok(r.status === 429, "bob: failed attempt still counts; second attempt -> 429", `${r.status}`);

// --- Provider capacity exhaustion ------------------------------------------------
const carol = await signIn("carol");
await mock.mode("capacity");
const before2 = (await mock.stats()).requests;
r = await mission(carol);
const cap = r.events.find((e) => e.type === "error");
ok(cap?.code === "provider_capacity", "carol: provider capacity error surfaced as capacity", cap?.message);
ok((await mock.stats()).requests === before2 + 1, "carol: capacity error made exactly one request, no fallback");

// --- Global daily capacity (DAILY_GLOBAL_MISSIONS=4 in this run) -------------
const dave = await signIn("dave");
await mock.mode("ok");
r = await mission(dave);
ok(r.status === 200, "dave: takes the last global slot (4/4)");
const frank = await signIn("frank");
const before3 = (await mock.stats()).requests;
r = await mission(frank);
ok(r.status === 429 && r.json?.code === "global_limit" && r.json?.fallback === "demo", "frank: global capacity exhausted -> 429 global_limit + demo", `${r.status} ${r.json?.code}`);
ok((await mock.stats()).requests === before3, "frank: no provider request once capacity is exhausted");
usage = await fetch(`${BASE}/api/usage`, { headers: frank }).then((r) => r.json());
ok(usage.compact.available === false && /capacity has been used/.test(usage.compact.reason), "usage API tells the UI to fall back to demo", usage.compact.reason);

// --- Cross-user isolation -------------------------------------------------------
const bobMissions = await fetch(`${BASE}/api/missions`, { headers: bob }).then((r) => r.json());
ok(bobMissions.every((m) => m.id !== aliceMissionId), "bob's mission list excludes alice's missions");
ok((await fetch(`${BASE}/api/missions/${aliceMissionId}`, { headers: bob })).status === 404, "bob cannot open alice's mission by id -> 404");
const rev = await fetch(`${BASE}/api/missions/${aliceMissionId}/review`, {
  method: "POST",
  headers: bob,
  body: JSON.stringify({ verdict: "reject", feedback: "hijack" }),
});
ok(rev.status === 404, "bob cannot review alice's mission -> 404");

// --- Secrets ---------------------------------------------------------------------
const pub = JSON.stringify(await fetch(`${BASE}/api/usage`, { headers: alice }).then((r) => r.json()));
ok(!pub.includes("cf-test-token-SECRET") && !pub.includes("SERVICE"), "usage API exposes no provider credentials");

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll live-guard checks passed.");
process.exit(failures ? 1 : 0);
