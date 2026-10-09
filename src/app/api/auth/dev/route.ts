import { cookies } from "next/headers";
import { z } from "zod";
import { DEV_USER_COOKIE } from "@/lib/auth";
import { isLocalMode } from "@/lib/config";

const Body = z.object({ name: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,32}$/) });

/**
 * Local development sign-in: pick a name and you're that user. It only exists when
 * Supabase isn't configured AND the app isn't deployed, and returns 404 everywhere else.
 */
export async function POST(request: Request) {
  if (!isLocalMode()) return new Response(null, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Use 1–32 letters, numbers or dashes." }, { status: 400 });
  }
  (await cookies()).set(DEV_USER_COOKIE, parsed.data.name, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return Response.json({ ok: true });
}
