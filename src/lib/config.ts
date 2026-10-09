import "server-only";

/**
 * Zero-spend configuration. Every value is server-only; nothing here reaches the browser.
 * Paid paths are opt-in: they default to off, and missing config fails closed.
 */
const int = (v: string | undefined, fallback: number) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined || v === "" ? fallback : v.toLowerCase() === "true";

export const config = {
  aiProvider: (process.env.AI_PROVIDER ?? "cloudflare") as "cloudflare",
  /** Global kill switch for every live AI request. */
  liveAiEnabled: bool(process.env.LIVE_AI_ENABLED, true),
  dailyUserMissions: int(process.env.DAILY_USER_MISSIONS, 1),
  dailyGlobalMissions: int(process.env.DAILY_GLOBAL_MISSIONS, 20),
  /** Stops one network from cycling through accounts. */
  dailyIpMissions: int(process.env.DAILY_IP_MISSIONS, 3),
  maxInputChars: Math.min(int(process.env.MAX_MISSION_INPUT_CHARS, 6000), 6000),
  maxOutputTokens: Math.min(int(process.env.MAX_OUTPUT_TOKENS, 1200), 1200),

  cloudflare: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    apiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
    model: process.env.CLOUDFLARE_AI_MODEL ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    /** Overridable only for local tests against a mock server. */
    apiBase: process.env.CLOUDFLARE_API_BASE ?? "https://api.cloudflare.com/client/v4",
  },

  /** Anthropic is paid. Off unless a developer explicitly enables it, and never on a public deploy. */
  anthropicEnabled: bool(process.env.ANTHROPIC_ENABLED, false),

  turnstile: {
    siteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
    secretKey: process.env.TURNSTILE_SECRET_KEY ?? "",
  },

  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  },

  ipHashSalt: process.env.IP_HASH_SALT ?? "",
};

export const hasSupabase = () =>
  Boolean(config.supabase.url && config.supabase.anonKey && config.supabase.serviceRoleKey);

/** True on Vercel or any deployed environment, where local-only conveniences must stay off. */
export const isDeployed = () => Boolean(process.env.VERCEL) || process.env.FORGE_DEPLOYED === "true";

/** Local file storage plus dev sign-in. Only when Supabase isn't configured and we're not deployed. */
export const isLocalMode = () => !hasSupabase() && !isDeployed();

export const hasCloudflare = () => Boolean(config.cloudflare.accountId && config.cloudflare.apiToken);

/** Full Swarm (four paid Claude calls) only runs locally, with an explicit opt-in and the developer's own key. */
export const fullSwarmAvailable = () =>
  isLocalMode() && config.anthropicEnabled && Boolean(process.env.ANTHROPIC_API_KEY);
