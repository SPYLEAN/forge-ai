import { z } from "zod";
import { getViewer, unauthorized } from "@/lib/auth";
import { config, fullSwarmAvailable, hasCloudflare } from "@/lib/config";
import { storeFor } from "@/lib/store";
import { partnerPreamble, selectLessons } from "@/lib/agents";
import { claimLiveMission, finishLiveMission, hashIp, LIMIT_MESSAGES, nextReset } from "@/lib/usage";
import { verifyTurnstile } from "@/lib/turnstile";
import { cloudflareProvider } from "@/lib/providers/cloudflare";
import { anthropicProvider } from "@/lib/providers/anthropic";
import { ProviderError, type SwarmProvider } from "@/lib/providers/types";
import type { MissionEvent } from "@/lib/types";

// Compact Swarm is a single call with a 55s timeout. Full Swarm only runs locally.
export const maxDuration = 60;

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return unauthorized();
  return Response.json(await storeFor(viewer).listMissions());
}

const Body = z.object({
  brief: z.string().trim(),
  mode: z.enum(["compact", "full"]),
  turnstileToken: z.string().optional(),
});

const fail = (status: number, code: string, error: string, extra: object = {}) =>
  Response.json({ error, code, ...extra }, { status });

/**
 * Start a LIVE mission. Guards run in this order, and nothing reaches a provider
 * until all of them pass:
 * auth → input limits → kill switch / provider → Turnstile → partner → atomic quota claim.
 */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return fail(401, "auth_required", "Click Get started to run a live mission. The interactive demo needs no account.");

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "Invalid mission request.");
  const { brief, mode, turnstileToken } = parsed.data;
  if (brief.length < 10) return fail(400, "invalid", "Describe the mission in at least 10 characters.");
  if (brief.length > config.maxInputChars) {
    return fail(400, "too_long", `Mission briefs are limited to ${config.maxInputChars.toLocaleString()} characters.`);
  }

  let provider: SwarmProvider;
  if (mode === "full") {
    if (!fullSwarmAvailable()) {
      return fail(403, "full_disabled", "Full Swarm is turned off on this deployment. It only runs in local development with your own key.");
    }
    provider = anthropicProvider;
  } else {
    if (!config.liveAiEnabled) {
      return fail(503, "live_disabled", "Live AI missions are paused right now. The interactive demo is still available.");
    }
    if (!hasCloudflare()) {
      return fail(503, "provider_unconfigured", "No free AI provider is configured. The interactive demo is still available.");
    }
    provider = cloudflareProvider;
  }

  if (!(await verifyTurnstile(turnstileToken, request))) {
    return fail(403, "turnstile_failed", "The human check failed or expired. Please try again.");
  }

  const store = storeFor(viewer);
  const partner = await store.getPartner();
  if (!partner) return fail(409, "no_partner", "Imprint your partner first.");

  // Reserve quota atomically BEFORE spending anything. Never refunded, never retried.
  const claim = await claimLiveMission(viewer.userId, hashIp(request), provider.id);
  if (!claim.ok) {
    return fail(429, claim.reason, LIMIT_MESSAGES[claim.reason], { resetAt: nextReset(), fallback: "demo" });
  }

  let mission;
  let preamble: string;
  try {
    const lessons = selectLessons(await store.listLessons(), brief, mode === "compact" ? 10 : 25);
    mission = await store.createMission({
      partnerId: partner.id,
      brief,
      mode,
      provider: provider.id,
      appliedLessonIds: lessons.map((l) => l.id),
    });
    preamble = partnerPreamble(partner, lessons);
  } catch (err) {
    await finishLiveMission(claim.usageId, { success: false, inputUnits: 0, outputUnits: 0, missionId: null });
    throw err;
  }
  const missionId = mission.id;
  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: MissionEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          open = false;
        }
      };
      send({ type: "mission", mission });

      try {
        const { result, usage } = await provider.run({ preamble, brief, signal: abort.signal, emit: send });
        await finishLiveMission(claim.usageId, { success: true, ...usage, missionId });
        const { gates, ...outputs } = result;
        const done = await store.updateMission(missionId, { outputs, gates, status: "awaiting_review" });
        send({ type: "done", mission: done });
      } catch (err) {
        const pe = err instanceof ProviderError ? err : null;
        const message = pe?.message ?? (err instanceof Error ? err.message : "The mission failed.");
        // Record the failed attempt. It still counts against the quota, and nothing is retried.
        await finishLiveMission(claim.usageId, {
          success: false,
          inputUnits: pe?.usage.inputUnits ?? 0,
          outputUnits: pe?.usage.outputUnits ?? 0,
          missionId,
        });
        await store.updateMission(missionId, { status: "failed", error: message }).catch(() => {});
        send({ type: "error", message, code: pe?.code === "capacity" ? "provider_capacity" : "provider_error" });
      } finally {
        if (open) controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
