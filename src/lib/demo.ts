import type { AgentRole, Gates } from "./types";

/**
 * Pre-written Interactive Demo missions. These were written in advance, not generated
 * at request time, and the UI always says so. Playing them makes no network request.
 */
export type DemoMission = {
  id: string;
  title: string;
  brief: string;
  outputs: Record<AgentRole, string>;
  gates: Gates;
};

export const DEMO_MISSIONS: DemoMission[] = [
  {
    id: "rate-limit",
    title: "Rate-limit an API route",
    brief:
      "Add rate limiting to our Next.js API route POST /api/contact: 5 requests per minute per IP, a friendly 429 message, and it has to work on Vercel.",
    outputs: {
      architect: `## Outcome
A visitor who spams the contact form gets a clear "slow down" message after 5 tries a minute. Normal visitors never notice.

## Assumptions & risks
- Vercel runs many short-lived instances, so **an in-memory counter is useless** **(riskiest)**.
- We can use a free hosted Redis (Upstash) through its REST API, which needs no TCP sockets.
- The client IP comes from \`x-forwarded-for\` on Vercel.

## Design
A sliding-window counter keyed by \`ratelimit:contact:<ip>\` in Redis. The check runs at the top of the route handler, before any work, and fails open if Redis is down (logged) so the form never hard-breaks.

## Slices
1. \`lib/rate-limit.ts\`: a \`limit(key, max, windowSec)\` helper.
2. Wire it into \`app/api/contact/route.ts\` and return 429 with \`Retry-After\`.
3. Show the 429 message in the contact form UI.

## Non-goals
Per-user limits, an admin dashboard, or CAPTCHA.`,
      builder: `### lib/rate-limit.ts
\`\`\`ts
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv(); // UPSTASH_REDIS_REST_URL / _TOKEN

export type LimitResult = { ok: boolean; remaining: number; retryAfter: number };

export async function limit(key: string, max: number, windowSec: number): Promise<LimitResult> {
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    const ttl = await redis.ttl(key);
    return { ok: count <= max, remaining: Math.max(0, max - count), retryAfter: Math.max(ttl, 1) };
  } catch (err) {
    console.error("rate limiter unavailable, failing open", err);
    return { ok: true, remaining: max, retryAfter: 0 };
  }
}
\`\`\`

### app/api/contact/route.ts
\`\`\`ts
import { z } from "zod";
import { limit } from "@/lib/rate-limit";

const Body = z.object({ email: z.email(), message: z.string().min(1).max(2000) });

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await limit(\`ratelimit:contact:\${ip}\`, 5, 60);
  if (!rl.ok) {
    return Response.json(
      { error: "You're sending messages too quickly. Try again in a minute." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Check your email and message." }, { status: 400 });
  // ...send the message
  return Response.json({ ok: true });
}
\`\`\`

## Notes
Slice 3 (the UI message) is not built here. The route already returns a readable \`error\` string.`,
      critic: `## Findings
1. **[major]** \`lib/rate-limit.ts\`: \`incr\` and \`expire\` are two separate calls. If the function dies between them, the key never expires and that IP is locked out forever. **Fix:** use a pipeline/\`multi\` or \`SET key 0 EX 60 NX\` before \`INCR\`.
2. **[minor]** This is a *fixed* window, not the sliding window the plan describes. A client can send 10 requests across a window boundary. That's fine for a contact form, but the plan should say "fixed window".
3. **[minor]** Every unknown IP shares the key \`unknown\`, so behind a misconfigured proxy all users throttle each other. Log when the header is missing.

## Weak evidence
"Fails open" is stated but nothing alerts anyone that limiting is off.

## Verdict
**REVISE**: fix the incr/expire race before shipping. The rest is sound.`,
      witness: `## Critical journey trace
1. Visitor submits the form, which hits \`POST /api/contact\` in \`app/api/contact/route.ts\`.
2. \`limit()\` increments \`ratelimit:contact:<ip>\`. Requests 1–5 → \`ok: true\`.
3. 6th request in the window → 429 with \`Retry-After\` ✓
4. Form shows the message: **not supported yet**. Slice 3 is unbuilt.

## Run this to verify
\`\`\`bash
for i in $(seq 1 6); do curl -s -o /dev/null -w "%{http_code}\\n" -X POST localhost:3000/api/contact -H 'content-type: application/json' -d '{"email":"a@b.co","message":"hi"}'; done
\`\`\`
Expect five 200s, then one 429.

## Handoff
The server-side limit works on Vercel. Before shipping, fix the expire race flagged by the Critic and build the UI message. Desk-checked only: nothing here was executed.`,
    },
    gates: { intent: "pass", journey: "fail", craft: "pass", correctness: "fail", safety: "pass", truth: "pass" },
  },
  {
    id: "empty-states",
    title: "Fix a broken dashboard list",
    brief:
      "Our React dashboard's project list shows a blank screen while loading and crashes when the API returns an error. Make loading, empty and error states proper.",
    outputs: {
      architect: `## Outcome
Users always see something meaningful: a skeleton while loading, a helpful empty state, and a recoverable error with a retry.

## Assumptions & risks
- Data comes from \`fetch("/api/projects")\` inside \`useEffect\` today.
- The crash is \`projects.map\` on an error object **(riskiest: it may hide other callers relying on the shape)**.

## Design
Model the request as a discriminated union, \`loading | error | ready\`, so the impossible states (data and error at once) can't be represented. Keep it in one hook so other lists can reuse it.

## Slices
1. \`useProjects()\` hook returning the union plus \`retry()\`.
2. \`ProjectList\` renders each state.
3. An accessible skeleton (\`aria-busy\`) and focus moved to the error message.

## Non-goals
Caching or pagination.`,
      builder: `### src/hooks/useProjects.ts
\`\`\`ts
import { useCallback, useEffect, useState } from "react";

export type Project = { id: string; name: string };
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; projects: Project[] };

export function useProjects() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ status: "loading" });
    fetch("/api/projects", { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 401 ? "Your session expired. Sign in again." : "We couldn't load your projects.");
        setState({ status: "ready", projects: (await r.json()) as Project[] });
      })
      .catch((e) => !ctrl.signal.aborted && setState({ status: "error", message: e.message }));
    return () => ctrl.abort();
  }, [attempt]);

  return { state, retry: useCallback(() => setAttempt((n) => n + 1), []) };
}
\`\`\`

### src/components/ProjectList.tsx
\`\`\`tsx
export function ProjectList() {
  const { state, retry } = useProjects();
  if (state.status === "loading") return <ul aria-busy="true">{[0, 1, 2].map((i) => <li key={i} className="skeleton" />)}</ul>;
  if (state.status === "error")
    return (
      <div role="alert">
        <p>{state.message}</p>
        <button onClick={retry}>Try again</button>
      </div>
    );
  if (state.projects.length === 0) return <p>No projects yet. Create your first one to get started.</p>;
  return <ul>{state.projects.map((p) => <li key={p.id}>{p.name}</li>)}</ul>;
}
\`\`\`

## Notes
Moving focus to the error (slice 3) is not built.`,
      critic: `## Findings
1. **[minor]** \`ProjectList.tsx\` doesn't import \`useProjects\`, so it won't compile as written. **Fix:** add the import.
2. **[minor]** The response is cast with \`as Project[]\` and never validated, so a malformed payload renders \`undefined\` names. Validate it with zod at the boundary.
3. **[minor]** The skeleton \`<li>\`s have no accessible label. Add \`aria-label="Loading projects"\` on the list.

## Weak evidence
None. The claims match the code.

## Verdict
**SHIP** after adding the missing import. The state model is the right fix.`,
      witness: `## Critical journey trace
1. Mount → \`useProjects\` sets \`loading\` → skeleton with \`aria-busy\` ✓
2. 200 with \`[]\` → empty-state copy ✓
3. 500 → \`error\` → \`role="alert"\` message and retry ✓
4. Retry → \`attempt\` increments → effect re-runs → \`loading\` ✓
5. Unmount mid-request → aborted, so no state update on an unmounted component ✓

## Run this to verify
Throttle the network in DevTools, then block \`/api/projects\` to see the error state and click **Try again**.

## Handoff
The blank screen and the crash are both fixed by one state model. Add the missing import before merging. Desk-checked only.`,
    },
    gates: { intent: "pass", journey: "pass", craft: "pass", correctness: "unverified", safety: "pass", truth: "pass" },
  },
  {
    id: "signup-validation",
    title: "Validate a signup form",
    brief: "Add server-side validation to our signup endpoint: valid email, password 12+ chars, and clear field-level error messages.",
    outputs: {
      architect: `## Outcome
A user who makes a mistake sees exactly which field is wrong and why, and invalid data never reaches the database.

## Assumptions & risks
- Client-side checks exist but can be bypassed **(riskiest: the server currently trusts them)**.
- Error messages must not reveal whether an email is already registered (account enumeration).

## Design
One zod schema shared by the client and the server. The server returns \`{ fieldErrors }\` with status 422, and the client maps those onto inputs with \`aria-describedby\`.

## Slices
1. \`lib/signup-schema.ts\`
2. The server route validates and returns 422.
3. The form renders field errors accessibly.

## Non-goals
Password strength meters or breached-password checks.`,
      builder: `### lib/signup-schema.ts
\`\`\`ts
import { z } from "zod";

export const SignupSchema = z.object({
  email: z.email("Enter a valid email address.").max(254),
  password: z.string().min(12, "Use at least 12 characters.").max(200),
});
\`\`\`

### app/api/signup/route.ts
\`\`\`ts
import { SignupSchema } from "@/lib/signup-schema";

export async function POST(req: Request) {
  const parsed = SignupSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  // createUser(parsed.data). On a duplicate email, still return the same success
  // response and send a "you already have an account" email instead.
  return Response.json({ ok: true }, { status: 201 });
}
\`\`\``,
      critic: `## Findings
1. **[major]** Slice 3 (the accessible field errors in the form) isn't built, so users still won't *see* the messages. **Fix:** render \`fieldErrors\` next to each input, linked with \`aria-describedby\`.
2. **[minor]** \`.flatten()\` is deprecated in newer zod versions. Use \`z.flattenError(parsed.error)\`.

## Weak evidence
The duplicate-email handling is only a comment.

## Verdict
**REVISE**: the server half is correct, but the user-facing half is missing.`,
      witness: `## Critical journey trace
1. Submit a bad email → 422 \`{ fieldErrors: { email: [...] } }\` ✓
2. Submit an 8-char password → 422 with the password message ✓
3. User sees the error next to the field: **not supported yet**. No form code was built.

## Run this to verify
\`\`\`bash
curl -s -X POST localhost:3000/api/signup -H 'content-type: application/json' -d '{"email":"nope","password":"short"}'
\`\`\`

## Handoff
Server-side validation is done and safe against bypass. The form still needs to display the errors. Desk-checked only.`,
    },
    gates: { intent: "pass", journey: "fail", craft: "unverified", correctness: "pass", safety: "pass", truth: "pass" },
  },
];
