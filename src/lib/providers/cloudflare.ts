import "server-only";
import { config } from "../config";
import { normalizeGates } from "../gates";
import { AGENTS, type AgentRole } from "../types";
import { ProviderError, SwarmResultSchema, type SwarmProvider } from "./types";

const COMPACT_INSTRUCTIONS = `You are running a COMPACT SWARM: one model writing four specialist perspectives in sequence. Keep the whole answer short, because the output budget is about 1,100 tokens.

Write exactly these five parts in this order, each starting with its marker on its own line:

<<<ARCHITECT>>>
Outcome (1 sentence), riskiest assumption (1 bullet), and 2–4 numbered thin slices. Max 120 words.
<<<BUILDER>>>
The code for slice 1 only, in one or two fenced code blocks, each preceded by "### path/to/file". Follow the user's standards and lessons. Max 450 tokens.
<<<CRITIC>>>
2–4 numbered findings, most severe first, each with [blocker]/[major]/[minor], a concrete failure scenario and the fix. End with "Verdict: SHIP", "Verdict: REVISE" or "Verdict: BLOCK". Max 140 words.
<<<WITNESS>>>
A desk-check only. You cannot run code, so never claim tests ran. Give a 3–5 step trace of the main user flow, then "Run this to verify:" with 1–3 commands. Max 110 words.
<<<GATES>>>
One line of JSON and nothing else:
{"intent":"pass|fail|unverified","journey":"pass|fail|unverified","craft":"pass|fail|unverified","correctness":"pass|fail|unverified","safety":"pass|fail|unverified","truth":"pass|fail|unverified"}
Use "unverified" whenever only running the code could tell.`;

const MARKER = /<<<\s*(ARCHITECT|BUILDER|CRITIC|WITNESS|GATES)\s*>>>/g;

/** Split the marked text into the shared SwarmResult. Exported for tests. */
export function parseCompact(text: string) {
  const parts: Partial<Record<AgentRole | "gates", string>> = {};
  const hits = [...text.matchAll(MARKER)];
  hits.forEach((m, i) => {
    const key = m[1].toLowerCase() as AgentRole | "gates";
    const end = i + 1 < hits.length ? hits[i + 1].index : text.length;
    parts[key] = text.slice(m.index + m[0].length, end).trim();
  });

  let gates = null;
  const json = parts.gates?.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      gates = normalizeGates(JSON.parse(json));
    } catch {
      gates = null;
    }
  }

  // Missing sections are labelled honestly. They're never invented.
  const missing = "_Not produced. The model ran out of its output budget before this section._";
  const missingCount = AGENTS.filter((a) => !parts[a]).length;
  return {
    missingCount,
    result: SwarmResultSchema.safeParse({
      architect: parts.architect || missing,
      builder: parts.builder || missing,
      critic: parts.critic || missing,
      witness: parts.witness || missing,
      gates,
    }),
  };
}

type CfResponse = {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: {
    response?: unknown;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
};

export const cloudflareProvider: SwarmProvider = {
  id: "cloudflare",
  label: "Cloudflare Workers AI",
  model: config.cloudflare.model,

  async run({ preamble, brief, signal, emit }) {
    for (const a of AGENTS) emit({ type: "agent_start", agent: a });

    const url = `${config.cloudflare.apiBase}/accounts/${encodeURIComponent(config.cloudflare.accountId)}/ai/run/${config.cloudflare.model}`;
    let res: Response;
    try {
      // Exactly one request. No retries, no fallback model, no parallel calls.
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.cloudflare.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: `${preamble}\n\n${COMPACT_INSTRUCTIONS}` },
            { role: "user", content: `Mission:\n${brief}` },
          ],
          max_tokens: config.maxOutputTokens,
          temperature: 0.4,
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(55_000)]),
      });
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "TimeoutError";
      throw new ProviderError(
        timedOut ? "The free model took too long to respond." : "Couldn't reach Cloudflare Workers AI.",
        timedOut ? "timeout" : "upstream",
      );
    }

    const data = (await res.json().catch(() => ({}))) as CfResponse;
    if (res.status === 429 || res.status === 402) {
      throw new ProviderError("The free AI provider's daily allocation is used up.", "capacity");
    }
    if (!res.ok || data.success === false) {
      const msg = data.errors?.[0]?.message ?? `HTTP ${res.status}`;
      // Cloudflare reports an exhausted free allocation as an error body too.
      if (/neuron|limit|quota|capacity/i.test(msg)) {
        throw new ProviderError("The free AI provider's daily allocation is used up.", "capacity");
      }
      throw new ProviderError(`Cloudflare Workers AI error: ${msg}`, "upstream");
    }

    const raw = data.result?.response;
    const text = typeof raw === "string" ? raw : raw ? JSON.stringify(raw) : "";
    const usage = {
      inputUnits: data.result?.usage?.prompt_tokens ?? 0,
      outputUnits: data.result?.usage?.completion_tokens ?? 0,
    };

    const { result, missingCount } = parseCompact(text);
    if (!result.success || missingCount >= 3) {
      throw new ProviderError("The free model didn't return the four sections in the expected format.", "bad_output", usage);
    }
    for (const a of AGENTS) {
      emit({ type: "section", agent: a, text: result.data[a] });
      emit({ type: "agent_done", agent: a });
    }
    return { result: result.data, usage };
  },
};
