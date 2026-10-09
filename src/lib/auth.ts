import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSupabase, isLocalMode } from "./config";
import { createUserClient } from "./supabase";

export type Viewer = {
  userId: string;
  email: string | null;
  /** Present in Supabase mode: a client bound to this user's session (RLS applies). */
  db: SupabaseClient | null;
};

export const DEV_USER_COOKIE = "forge_dev_user";

/** The signed-in user, or null for anonymous visitors. */
export async function getViewer(): Promise<Viewer | null> {
  if (hasSupabase()) {
    const db = await createUserClient();
    const { data, error } = await db.auth.getClaims();
    const claims = data?.claims;
    if (error || !claims?.sub) return null;
    return { userId: claims.sub, email: (claims.email as string | undefined) ?? null, db };
  }

  // Local development only: a named dev identity, so per-user quotas can be exercised
  // without a Supabase project. isLocalMode() is false on any deployment.
  if (isLocalMode()) {
    const name = (await cookies()).get(DEV_USER_COOKIE)?.value;
    if (!name || !/^[a-z0-9-]{1,32}$/.test(name)) return null;
    return { userId: `local-${name}`, email: `${name}@local.dev`, db: null };
  }

  return null;
}

export function unauthorized() {
  return Response.json(
    { error: "Sign in to use this.", code: "auth_required" },
    { status: 401 },
  );
}
