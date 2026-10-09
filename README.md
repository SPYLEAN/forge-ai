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
| **Compact Swarm** | **One** Cloudflare Workers AI request (≤6,000 chars in, ≤1,200 tokens out) | Signed-in users, 1 per day | "Generated · Compact Swarm: a one-model simulation of four specialist perspectives" |
| **Full Swarm** | Four Claude calls (Architect → Builder → Critic → Witness) | **Local development only**, with `ANTHROPIC_ENABLED=true` and the developer's own key | "Generated · Full Swarm" |

Both live modes return the same validated `SwarmResult` (`architect`, `builder`, `critic`, `witness`, `gates`) through one `SwarmProvider` interface (`src/lib/providers/`).

## Usage protection

Every live request passes these guards in order (`src/app/api/missions/route.ts`). Nothing reaches a provider until all of them pass:

1. **Auth.** Anonymous visitors get 401.
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

With no Supabase variables set, the app runs in **local mode**: data lives in `.forge-data/db.json` and sign-in is a dev-only username form. Local mode turns itself off on Vercel or when `FORGE_DEPLOYED=true` is set.

## Deploy (all free)

1. **Supabase:** create a project and run `supabase/schema.sql`. Under Auth → URL Configuration, add `https://<your-app>/auth/callback` as a redirect URL.
2. **Cloudflare:** stay on the **Workers Free plan**. Create an API token with only *Workers AI: Read*, and a Turnstile widget for your domain.
3. **Vercel Hobby:** import the repo and set the variables from `.env.example`.

## Verification

```bash
npm run verify:db       # RLS + quota function against real Postgres (PGlite)
npm run mock:cloudflare # in one terminal
npm run verify:live -- http://127.0.0.1:3217   # against `next start -p 3217` (see script header for env)
```

## Known limits

- Supabase's built-in email sender allows only a few sign-in emails per hour. For more, configure a free SMTP provider in Supabase.
- The RLS policies are verified in PGlite with a stub of Supabase's `auth` schema, not yet against a live Supabase project.
- The agents can't execute code. The Witness's gates are a desk-check, and the UI says so.
- Compact Swarm answers are short by design (a ~1,200-token budget for four perspectives).
