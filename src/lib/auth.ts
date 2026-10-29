import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { config, hasOwnerLogin, hasSupabase, isLocalMode } from "./config";
import { createUserClient } from "./supabase";

export type Viewer = {
  userId: string;
  email: string | null;
  /** A no-email guest account (Supabase anonymous sign-in or a local dev guest). */
  guest: boolean;
  /** Present in Supabase mode: a client bound to this user's session (RLS applies). */
  db: SupabaseClient | null;
};

export const DEV_USER_COOKIE = "forge_dev_user";
export const OWNER_COOKIE = "forge_session";
export const OWNER_SESSION_SECONDS = 60 * 60 * 24 * 7;

const sign = (payload: string) =>
  createHmac("sha256", config.owner.sessionSecret).update(payload).digest("base64url");

/** Constant-time string comparison, so response timing doesn't leak how much of a guess was right. */
export function safeEqual(a: string, b: string) {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * In Supabase mode the owner is one real Supabase user. Its password is derived from the
 * session secret, so it never needs storing and only this server can sign in as it.
 */
export const ownerSupabaseEmail = () => `owner+${config.owner.username.toLowerCase()}@example.com`;
export const ownerSupabasePassword = () => sign(`supabase-owner:${config.owner.username}`);

/** `<username>.<expiry>.<hmac>`; changing FORGE_SESSION_SECRET signs everyone out. */
export function ownerSessionValue() {
  const payload = `${Buffer.from(config.owner.username).toString("base64url")}.${
    Math.floor(Date.now() / 1000) + OWNER_SESSION_SECONDS
  }`;
  return `${payload}.${sign(payload)}`;
}

function readOwnerSession(value: string | undefined): string | null {
  const [user, exp, mac] = value?.split(".") ?? [];
  if (!user || !exp || !mac) return null;
  if (!safeEqual(mac, sign(`${user}.${exp}`))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  const username = Buffer.from(user, "base64url").toString();
  return username === config.owner.username ? username : null;
}

/** The signed-in user, or null for anonymous visitors. */
export async function getViewer(): Promise<Viewer | null> {
  if (hasSupabase()) {
    const db = await createUserClient();
    const { data, error } = await db.auth.getClaims();
    const claims = data?.claims;
    if (error || !claims?.sub) return null;
    // Owner mode: any other Supabase account (e.g. one made through the public sign-up API) is refused.
    if (hasOwnerLogin() && claims.email !== ownerSupabaseEmail()) return null;
    return {
      userId: claims.sub,
      email: hasOwnerLogin() ? config.owner.username : (claims.email as string | undefined) || null,
      guest: claims.is_anonymous === true,
      db,
    };
  }

  // Single-owner mode: only the account in FORGE_LOGIN_USER / FORGE_LOGIN_PASSWORD exists.
  if (hasOwnerLogin()) {
    const username = readOwnerSession((await cookies()).get(OWNER_COOKIE)?.value);
    if (!username) return null;
    return { userId: `owner-${username}`, email: username, guest: false, db: null };
  }

  // Local development only: a named dev identity, so per-user quotas can be exercised
  // without a Supabase project. isLocalMode() is false on any deployment.
  if (isLocalMode()) {
    const name = (await cookies()).get(DEV_USER_COOKIE)?.value;
    if (!name || !/^[a-z0-9-]{1,32}$/.test(name)) return null;
    return { userId: `local-${name}`, email: null, guest: name.startsWith("guest-"), db: null };
  }

  return null;
}

export function unauthorized() {
  return Response.json(
    { error: "Sign in to use this.", code: "auth_required" },
    { status: 401 },
  );
}
