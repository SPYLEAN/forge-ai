import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config";

/**
 * Client acting as the signed-in user. Every query runs under that user's JWT,
 * so Postgres row-level security decides what it can see.
 */
export async function createUserClient(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(config.supabase.url, config.supabase.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Called from a context that can't set cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

let admin: SupabaseClient | undefined;

/**
 * Service-role client. It bypasses RLS, so it's used ONLY for the quota system
 * (claim_live_mission and usage bookkeeping), never for reading user content.
 */
export function createAdminClient(): SupabaseClient {
  admin ??= createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
