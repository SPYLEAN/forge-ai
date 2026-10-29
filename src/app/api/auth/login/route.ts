import { cookies } from "next/headers";
import { z } from "zod";
import {
  OWNER_COOKIE,
  OWNER_SESSION_SECONDS,
  ownerSessionValue,
  ownerSupabaseEmail,
  ownerSupabasePassword,
  safeEqual,
} from "@/lib/auth";
import { config, hasOwnerLogin, hasSupabase, isDeployed } from "@/lib/config";
import { createAdminClient, createUserClient } from "@/lib/supabase";
import { hashIp } from "@/lib/usage";

const Body = z.object({ username: z.string().trim().max(100), password: z.string().max(200) });

// Failed attempts per IP hash. In memory, so it resets on restart and isn't shared
// between serverless instances, but it still turns guessing into a slow crawl.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; since: number }>();

/** Sign in as the one owner account set in FORGE_LOGIN_USER / FORGE_LOGIN_PASSWORD. */
export async function POST(request: Request) {
  if (!hasOwnerLogin()) return new Response(null, { status: 404 });

  const ip = hashIp(request);
  const entry = failures.get(ip);
  if (entry && Date.now() - entry.since > WINDOW_MS) failures.delete(ip);
  if ((failures.get(ip)?.count ?? 0) >= MAX_FAILURES) {
    return Response.json({ error: "Too many wrong attempts. Try again in 15 minutes." }, { status: 429 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  const username = parsed.success ? parsed.data.username : "";
  const password = parsed.success ? parsed.data.password : "";
  // Check both, always, so a wrong username takes as long as a wrong password.
  const userOk = safeEqual(username, config.owner.username);
  const passOk = safeEqual(password, config.owner.password);
  if (!(userOk && passOk)) {
    const prev = failures.get(ip);
    failures.set(ip, { count: (prev?.count ?? 0) + 1, since: prev?.since ?? Date.now() });
    return Response.json({ error: "Wrong username or password." }, { status: 401 });
  }

  failures.delete(ip);

  if (hasSupabase()) {
    const signedIn = await signInOwnerToSupabase();
    if (!signedIn.ok) {
      console.error("Owner Supabase sign-in failed:", signedIn.message);
      return Response.json(
        { error: "Signed in, but the database can't be reached right now. Please try again." },
        { status: 503 },
      );
    }
    return Response.json({ ok: true });
  }

  (await cookies()).set(OWNER_COOKIE, ownerSessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: isDeployed(),
    path: "/",
    maxAge: OWNER_SESSION_SECONDS,
  });
  return Response.json({ ok: true });
}

/** Signs in as the owner's Supabase user, creating it on first login. Session cookies go to the browser. */
async function signInOwnerToSupabase(): Promise<{ ok: true } | { ok: false; message: string }> {
  const credentials = { email: ownerSupabaseEmail(), password: ownerSupabasePassword() };
  const db = await createUserClient();
  let { error } = await db.auth.signInWithPassword(credentials);
  if (error?.code === "invalid_credentials") {
    const created = await createAdminClient().auth.admin.createUser({ ...credentials, email_confirm: true });
    if (created.error) return { ok: false, message: created.error.message };
    ({ error } = await db.auth.signInWithPassword(credentials));
  }
  return error ? { ok: false, message: error.message } : { ok: true };
}
