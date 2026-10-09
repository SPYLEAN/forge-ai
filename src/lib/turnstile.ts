import "server-only";
import { config, isLocalMode } from "./config";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const turnstileRequired = () => Boolean(config.turnstile.secretKey) || !isLocalMode();

/**
 * Verify a Turnstile token server-side. Fails closed: a deployment without a secret
 * key can't run live missions. Only local development may skip it.
 */
export async function verifyTurnstile(token: string | undefined, request: Request): Promise<boolean> {
  if (!config.turnstile.secretKey) return isLocalMode();
  if (!token || token.length > 2048) return false;
  const form = new FormData();
  form.append("secret", config.turnstile.secretKey);
  form.append("response", token);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(8000) });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
