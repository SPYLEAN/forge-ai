import { NextResponse } from "next/server";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { hasSupabase } from "@/lib/config";
import { createUserClient } from "@/lib/supabase";

/** Magic-link landing: exchange the one-time code for a session cookie. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // Supabase sends errors back as query params (e.g. an expired or already-used link).
  if (url.searchParams.get("error")) {
    return NextResponse.redirect(new URL("/?signin=expired", url.origin));
  }
  if (!hasSupabase() || !code) return NextResponse.redirect(new URL("/?signin=failed", url.origin));

  const db = await createUserClient();
  const { error } = await db.auth.exchangeCodeForSession(code);
  if (!error) return NextResponse.redirect(new URL("/", url.origin));

  console.error("Sign-in code exchange failed:", error.message);
  const reason = isAuthRetryableFetchError(error) || error.status === 0
    ? "unreachable"
    // No PKCE verifier cookie: the link was opened in a different browser or app
    // than the one that requested it (common when tapping it inside the Gmail app).
    : /code verifier|flow state/i.test(error.message)
      ? "other_browser"
      : "expired";
  return NextResponse.redirect(new URL(`/?signin=${reason}`, url.origin));
}
