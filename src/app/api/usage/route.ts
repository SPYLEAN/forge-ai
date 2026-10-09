import { getViewer } from "@/lib/auth";
import { config, fullSwarmAvailable, hasCloudflare, isLocalMode } from "@/lib/config";
import { turnstileRequired } from "@/lib/turnstile";
import { nextReset, usageCounts } from "@/lib/usage";
import type { UsageInfo } from "@/lib/types";

/** Public capacity info. No secrets, and no other user's data beyond aggregate counts. */
export async function GET() {
  const viewer = await getViewer();
  const used = await usageCounts(viewer?.userId ?? null);
  const remaining = viewer ? Math.max(0, config.dailyUserMissions - used.user) : 0;
  const globalLeft = config.dailyGlobalMissions - used.global;

  let reason: string | null = null;
  if (!config.liveAiEnabled) reason = "Live AI missions are paused right now.";
  else if (!hasCloudflare()) reason = "No free AI provider is configured on this deployment.";
  else if (turnstileRequired() && !(config.turnstile.siteKey && config.turnstile.secretKey))
    reason = "Human verification isn't configured on this deployment, so live missions are off.";
  else if (globalLeft <= 0) reason = "Today's free capacity has been used.";
  else if (!viewer) reason = "Sign in to get one free live mission a day.";
  else if (remaining <= 0) reason = "You've used today's free live mission.";

  const info: UsageInfo = {
    signedIn: Boolean(viewer),
    email: viewer?.email ?? null,
    localMode: isLocalMode(),
    provider: { id: "cloudflare", label: "Cloudflare Workers AI", model: config.cloudflare.model },
    liveEnabled: config.liveAiEnabled,
    compact: { available: reason === null, reason },
    full: { available: Boolean(viewer) && fullSwarmAvailable() },
    limits: {
      user: config.dailyUserMissions,
      global: config.dailyGlobalMissions,
      maxInputChars: config.maxInputChars,
    },
    used,
    remaining,
    resetAt: nextReset(),
    turnstileSiteKey: turnstileRequired() ? config.turnstile.siteKey || null : null,
  };
  return Response.json(info, { headers: { "Cache-Control": "no-store" } });
}
