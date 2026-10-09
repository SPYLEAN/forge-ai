import { z } from "zod";
import { hasSupabase } from "@/lib/config";
import { createUserClient } from "@/lib/supabase";

const Body = z.object({ email: z.email().max(254) });

/** Send a magic sign-in link. Supabase Auth applies its own per-email and per-IP rate limits. */
export async function POST(request: Request) {
  if (!hasSupabase()) {
    return Response.json({ error: "Sign-in isn't configured on this deployment." }, { status: 503 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address." }, { status: 400 });

  const origin = new URL(request.url).origin;
  const db = await createUserClient();
  const { error } = await db.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) {
    const status = error.status === 429 ? 429 : 400;
    return Response.json(
      { error: status === 429 ? "Too many sign-in emails. Wait a few minutes and try again." : error.message },
      { status },
    );
  }
  return Response.json({ sent: true });
}
