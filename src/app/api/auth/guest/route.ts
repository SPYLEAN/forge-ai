import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { DEV_USER_COOKIE } from "@/lib/auth";
import { hasOwnerLogin, hasSupabase, isLocalMode } from "@/lib/config";
import { createUserClient } from "@/lib/supabase";

/**
 * One-click start, with no email or password. Creates a Supabase anonymous user: a real
 * account id (so RLS and per-user quotas still apply) whose session lives in this
 * browser's cookies. Supabase rate-limits anonymous sign-ins per IP, and live AI
 * is still behind Turnstile plus the per-IP and global daily limits.
 */
export async function POST() {
  // Owner mode: nobody else gets an account.
  if (hasOwnerLogin()) return new Response(null, { status: 404 });

  if (hasSupabase()) {
    const db = await createUserClient();
    const { error } = await db.auth.signInAnonymously();
    if (!error) return Response.json({ ok: true });

    if (isAuthRetryableFetchError(error) || error.status === 0) {
      console.error("Supabase unreachable during guest sign-in:", error.message);
      return Response.json(
        { error: "The sign-in service can't be reached right now. Please try again later.", code: "auth_unreachable" },
        { status: 503 },
      );
    }
    if (error.code === "anonymous_provider_disabled") {
      console.error("Enable Anonymous Sign-Ins in Supabase: Authentication → Sign In / Providers.");
      return Response.json(
        { error: "Guest access isn't switched on for this site yet.", code: "guest_disabled" },
        { status: 503 },
      );
    }
    if (error.status === 429) {
      return Response.json({ error: "Too many new sessions from this network. Try again later." }, { status: 429 });
    }
    return Response.json({ error: error.message }, { status: 400 });
  }

  // Local development without Supabase: a random dev identity.
  if (isLocalMode()) {
    (await cookies()).set(DEV_USER_COOKIE, `guest-${randomUUID().slice(0, 8)}`, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Sign-in isn't configured on this deployment." }, { status: 503 });
}
