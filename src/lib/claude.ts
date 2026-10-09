import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";

let client: Anthropic | undefined;
export function getClaude(): Anthropic {
  // maxRetries: 0 means a failed paid request is never silently re-sent.
  client ??= new Anthropic({ maxRetries: 0 });
  return client;
}

/** Turn SDK errors into a message a user can act on. */
export function describeClaudeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError)
    return "Claude rejected the API key. Check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.RateLimitError)
    return "Claude rate limit reached. Wait a minute and try again.";
  if (err instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError)
    return "Couldn't reach the Claude API. Check your network connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
