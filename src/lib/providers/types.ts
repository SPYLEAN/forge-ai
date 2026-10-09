import "server-only";
import { z } from "zod";
import { GATE_NAMES, type MissionEvent } from "../types";

const Gate = z.enum(["pass", "fail", "unverified"]);

/** The one output shape every provider must produce, whether it made one model call or four. */
export const SwarmResultSchema = z.object({
  architect: z.string().trim().min(1).max(60000),
  builder: z.string().trim().min(1).max(60000),
  critic: z.string().trim().min(1).max(60000),
  witness: z.string().trim().min(1).max(60000),
  gates: z.object(Object.fromEntries(GATE_NAMES.map((g) => [g, Gate])) as Record<(typeof GATE_NAMES)[number], typeof Gate>).nullable(),
});
export type SwarmResult = z.infer<typeof SwarmResultSchema>;

export type ProviderUsage = { inputUnits: number; outputUnits: number };

export type ProviderRun = {
  /** Partner imprint plus selected lessons. */
  preamble: string;
  brief: string;
  signal: AbortSignal;
  emit: (e: MissionEvent) => void;
};

export interface SwarmProvider {
  id: "cloudflare" | "anthropic";
  label: string;
  model: string;
  run(input: ProviderRun): Promise<{ result: SwarmResult; usage: ProviderUsage }>;
}

/**
 * A provider failure. Callers must NOT retry: every attempt spends shared allowance.
 * `capacity` means the provider's free allocation or rate limit is exhausted.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: "capacity" | "upstream" | "bad_output" | "timeout",
    readonly usage: ProviderUsage = { inputUnits: 0, outputUnits: 0 },
  ) {
    super(message);
  }
}
