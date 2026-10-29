# FORGE AI

*Intelligence, forged around you.* Build an AI coding partner that learns how you think.

**Core loop:** Imprint → Assign → Orchestrate → Verify → Learn

FORGE AI is a **zero-spend student project**. It never needs a paid subscription, paid AI credits or a payment method, and no variable switches on a paid service by default.

| Piece | Service | Tier |
|---|---|---|
| Hosting | Vercel | Hobby |
| Auth and data | Supabase | Free |
| Live AI | Cloudflare Workers AI | Free (10,000 neurons/day) |
| Abuse protection | Cloudflare Turnstile | Free |

## Three modes

| Mode | What runs | Who can use it | Label in the UI |
|---|---|---|---|
| **Interactive demo** | Nothing. Pre-written missions replayed in the browser, with no network request | Everyone, unlimited, no account | "Pre-written · Interactive demo" |
| **Compact Swarm** | **One** Cloudflare Workers AI request (≤6,000 chars in, ≤1,200 tokens out) | Anyone who clicks *Get started* (guest account), 1 per day | "Generated · Compact Swarm: a one-model simulation of four specialist perspectives" |
| **Full Swarm** | Four Claude calls (Architect → Builder → Critic → Witness) | **Local development only**, with `ANTHROPIC_ENABLED=true` and the developer's own key | "Generated · Full Swarm" |

Both live modes return the same validated `SwarmResult` (`architect`, `builder`, `critic`, `witness`, `gates`) through one `SwarmProvider` interface (`src/lib/providers/`).

## Usage protection

Every live request passes these guards in order (`src/app/api/missions/route.ts`). Nothing reaches a provider until all of them pass:

1. **Auth.** Visitors without a session get 401. *Get started* creates a no-email guest account (Supabase anonymous sign-in), so the per-user limit is per browser; the per-IP and global limits are the real cap.
2. **Input limits.** Briefs over 6,000 characters get 400.
3. **Kill switch.** `LIVE_AI_ENABLED=false` returns 503 everywhere. Full Swarm returns 403 unless it's local dev with an explicit opt-in.
4. **Turnstile**, verified server-side. This fails closed: a deployment without the keys can't run live missions.
5. **Atomic quota claim.** `claim_live_mission()` in Postgres takes a transaction lock and checks the per-user, per-IP and global daily limits before inserting a `daily_usage` row. Over a limit returns **429** with `fallback: "demo"`.
6. **One provider call.** No retries (Claude also has `maxRetries: 0`), no fallback model, no parallel calls. A failed attempt still counts, and the real token usage is logged.

When capacity runs out, the UI shows "Today's free capacity has been used" and offers the demo. It doesn't present this as an error.

**Learning is free too.** Review feedback is saved as a lesson word for word, and the most relevant lessons go into later missions. A paid distillation step runs only in local Full Swarm mode.

## Security model

- Every table holding user data has `user_id` and owner-only RLS (`supabase/schema.sql`).
- User data is read and written **through the user's own session**, so Postgres enforces the isolation, not app code.
- The service-role key is used only for the quota ledger.
- `daily_usage` is read-only to its owner. Only the server can write it, so nobody can reset their own quota.
- Provider keys are server-only (modules import `server-only`). IPs are stored only as salted hashes.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

**Private owner mode (no Supabase).** Set `FORGE_LOGIN_USER`, `FORGE_LOGIN_PASSWORD` and `FORGE_SESSION_SECRET`, and leave the Supabase variables empty. Only that one account can sign in (signed, HTTP-only session cookie; 5 wrong attempts locks an IP out for 15 minutes), and data lives in `.forge-data/db.json`. On Vercel the data goes to `/tmp` instead, which resets whenever the instance restarts, so run the demo locally if you need it to last.

With no Supabase and no owner login set, the app runs in **local dev mode**: data lives in `.forge-data/db.json` and *Get started* creates a local guest identity. Local dev mode turns itself off on Vercel or when `FORGE_DEPLOYED=true` is set.

## Deploy (all free)

1. **Supabase:** create a project and run `supabase/schema.sql`. Under **Authentication → Sign In / Providers**, turn on **Allow anonymous sign-ins**. That's the one-click *Get started*, with no email verification. Optionally, under Bot and Abuse Protection, enable Turnstile CAPTCHA for sign-ins.
2. **Cloudflare:** stay on the **Workers Free plan**. Create an API token with only *Workers AI: Read*, and a Turnstile widget for your domain.
3. **Vercel Hobby:** import the repo and set the variables from `.env.example`.

## Verification

```bash
npm run check:supabase  # is the project in .env.local reachable, keys valid, schema run, guest sign-in on?
npm run verify:db       # RLS + quota function against real Postgres (PGlite)
npm run mock:cloudflare # in one terminal
npm run verify:live -- http://127.0.0.1:3217   # against `next start -p 3217` (see script header for env)
```

## Known limits

- Guest accounts live in the browser's cookies. Clearing cookies or switching devices starts over, and there's no account recovery. Supabase supports linking an email to a guest account later if you want that.
- The RLS policies are verified in PGlite with a stub of Supabase's `auth` schema, not yet against a live Supabase project.
- The agents can't execute code. The Witness's gates are a desk-check, and the UI says so.
- Compact Swarm answers are short by design (a ~1,200-token budget for four perspectives).
