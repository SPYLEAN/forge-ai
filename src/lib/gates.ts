import { GATE_NAMES, type GateResult, type Gates } from "./types";

/** Coerce any parsed object into a complete gates record; anything unclear is "unverified". */
export function normalizeGates(raw: unknown): Gates | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out = {} as Gates;
  for (const g of GATE_NAMES) {
    const v = typeof r[g] === "string" ? (r[g] as string).toLowerCase() : "";
    out[g] = (v === "pass" || v === "fail" ? v : "unverified") as GateResult;
  }
  return out;
}

/** Pull a ```gates {...}``` block out of Witness Markdown. */
export function splitGates(text: string): { body: string; gates: Gates | null } {
  const match = text.match(/```gates\s*([\s\S]*?)```/);
  if (!match) return { body: text, gates: null };
  let gates: Gates | null = null;
  try {
    gates = normalizeGates(JSON.parse(match[1]));
  } catch {
    // Malformed block: keep the text, drop the gate strip.
  }
  return { body: text.replace(match[0], "").trimEnd(), gates };
}
