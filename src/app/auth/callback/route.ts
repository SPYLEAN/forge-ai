import { NextResponse } from "next/server";
import { hasSupabase } from "@/lib/config";
import { createUserClient } from "@/lib/supabase";

/** Magic-link landing: exchange the one-time code for a session cookie. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (hasSupabase() && code) {
    const db = await createUserClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/", url.origin));
  }
  return NextResponse.redirect(new URL("/?signin=failed", url.origin));
}
