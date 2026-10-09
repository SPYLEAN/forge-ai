import "server-only";
import { createHash, randomUUID } from "crypto";
import { config, hasSupabase } from "./config";
import { createAdminClient } from "./supabase";
import { localDb } from "./store";

export type LimitReason = "user_limit" | "ip_limit" | "global_limit";
export type Claim = { ok: true; usageId: string } | { ok: false; reason: LimitReason };
export type UsageReport = {
  success: boolean;
  inputUnits: number;
  outputUnits: number;
  missionId: string | null;
};

/** Quotas reset at 00:00 UTC. */
export const today = () => new Date().toISOString().slice(0, 10);
export function nextReset(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

export const LIMIT_MESSAGES: Record<LimitReason, string> = {
  user_limit: "You've used today's free live mission. It resets at 00:00 UTC. The interactive demo is still unlimited.",
  ip_limit: "Too many live missions from this network today. The interactive demo is still unlimited.",
  global_limit: "Today's free capacity has been used. Live missions return at 00:00 UTC. The interactive demo is still unlimited.",
};

/** Client IPs are only ever stored as salted hashes. */
export function hashIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = fwd || request.headers.get("x-real-ip") || "unknown";
  const salt = config.ipHashSalt || config.supabase.serviceRoleKey || "forge-local-dev";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

const limits = () => ({
  user: config.dailyUserMissions,
  ip: config.dailyIpMissions,
  global: config.dailyGlobalMissions,
});

/**
 * Atomically check every limit and reserve one live request. This runs BEFORE any
 * provider call. The reservation is never refunded, so a failed request still counts
 * and can't be retried for free.
 */
export async function claimLiveMission(userId: string, ipHash: string, provider: string): Promise<Claim> {
  const l = limits();
  if (hasSupabase()) {
    const { data, error } = await createAdminClient().rpc("claim_live_mission", {
      p_user_id: userId,
      p_ip_hash: ipHash,
      p_provider: provider,
      p_user_limit: l.user,
      p_ip_limit: l.ip,
      p_global_limit: l.global,
    });
    if (error) throw new Error(`Quota check failed: ${error.message}`);
    const row = (data as { usage_id: string | null; outcome: string }[])[0];
    return row?.outcome === "ok" && row.usage_id
      ? { ok: true, usageId: row.usage_id }
      : { ok: false, reason: (row?.outcome as LimitReason) ?? "global_limit" };
  }

  // Local dev: same rules, made atomic by LocalDb's serialized writes.
  return localDb.mutate((db) => {
    const day = db.usage.filter((u) => u.usageDate === today());
    if (day.length >= l.global) return { ok: false, reason: "global_limit" } as const;
    if (day.filter((u) => u.userId === userId).length >= l.user) return { ok: false, reason: "user_limit" } as const;
    if (day.filter((u) => u.ipHash === ipHash).length >= l.ip) return { ok: false, reason: "ip_limit" } as const;
    const id = randomUUID();
    db.usage.push({
      id,
      userId,
      usageDate: today(),
      provider,
      requestCount: 1,
      inputUnits: 0,
      outputUnits: 0,
      missionId: null,
      status: "reserved",
      success: null,
      ipHash,
      createdAt: new Date().toISOString(),
    });
    return { ok: true, usageId: id } as const;
  });
}

/** Record what the provider actually reported using. */
export async function finishLiveMission(usageId: string, report: UsageReport): Promise<void> {
  const patch = {
    status: report.success ? "succeeded" : "failed",
    success: report.success,
    input_units: report.inputUnits,
    output_units: report.outputUnits,
    mission_id: report.missionId,
    finished_at: new Date().toISOString(),
  } as const;
  if (hasSupabase()) {
    const { error } = await createAdminClient().from("daily_usage").update(patch).eq("id", usageId);
    if (error) console.error("usage bookkeeping failed", error.message);
    return;
  }
  await localDb.mutate((db) => {
    const row = db.usage.find((u) => u.id === usageId);
    if (!row) return;
    Object.assign(row, {
      status: patch.status,
      success: patch.success,
      inputUnits: patch.input_units,
      outputUnits: patch.output_units,
      missionId: patch.mission_id,
    });
  });
}

/** Today's counts for display. Counts only; no other user's details leave the server. */
export async function usageCounts(userId: string | null): Promise<{ user: number; global: number }> {
  if (hasSupabase()) {
    const admin = createAdminClient();
    const global = await admin
      .from("daily_usage")
      .select("id", { count: "exact", head: true })
      .eq("usage_date", today());
    const user = userId
      ? await admin
          .from("daily_usage")
          .select("id", { count: "exact", head: true })
          .eq("usage_date", today())
          .eq("user_id", userId)
      : { count: 0 };
    return { user: user.count ?? 0, global: global.count ?? 0 };
  }
  const day = (await localDb.read()).usage.filter((u) => u.usageDate === today());
  return { user: userId ? day.filter((u) => u.userId === userId).length : 0, global: day.length };
}
