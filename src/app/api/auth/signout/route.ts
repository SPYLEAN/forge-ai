import { cookies } from "next/headers";
import { DEV_USER_COOKIE } from "@/lib/auth";
import { hasSupabase } from "@/lib/config";
import { createUserClient } from "@/lib/supabase";

export async function POST() {
  if (hasSupabase()) {
    await (await createUserClient()).auth.signOut();
  } else {
    (await cookies()).delete(DEV_USER_COOKIE);
  }
  return new Response(null, { status: 204 });
}
