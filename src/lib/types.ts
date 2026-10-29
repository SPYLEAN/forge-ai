export const AGENTS = ["architect", "builder", "critic", "witness"] as const;
export type AgentRole = (typeof AGENTS)[number];

export const GATE_NAMES = ["intent", "journey", "craft", "correctness", "safety", "truth"] as const;
export type GateResult = "pass" | "fail" | "unverified";
export type Gates = Record<(typeof GATE_NAMES)[number], GateResult>;

/** demo: pre-written, no AI. compact: one free Cloudflare call. full: four Claude calls (local dev only). */
export type MissionMode = "demo" | "compact" | "full";

export type Partner = {
  id: string;
  name: string;
  personality: string;
  standards: string;
  createdAt: string;
  updatedAt: string;
};

export type MissionStatus =
  | "running"
  | "awaiting_review"
  | "approved"
  | "rejected"
  | "failed";

/** A stored mission. Always produced by a real AI request; demo missions are never stored. */
export type Mission = {
  id: string;
  partnerId: string;
  brief: string;
  mode: Exclude<MissionMode, "demo">;
  provider: string;
  status: MissionStatus;
  outputs: Partial<Record<AgentRole, string>>;
  gates: Gates | null;
  /** Lessons that were injected into this run: evidence that learning is applied. */
  appliedLessonIds: string[];
  feedback: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Lesson = {
  id: string;
  partnerId: string;
  missionId: string | null;
  text: string;
  source: "approval" | "correction" | "manual";
  createdAt: string;
};

/** Newline-delimited JSON events streamed from POST /api/missions. */
export type MissionEvent =
  | { type: "mission"; mission: Mission }
  | { type: "agent_start"; agent: AgentRole }
  | { type: "delta"; agent: AgentRole; text: string }
  /** A whole section arriving at once (Compact Swarm returns all four together). */
  | { type: "section"; agent: AgentRole; text: string }
  | { type: "agent_done"; agent: AgentRole }
  | { type: "done"; mission: Mission }
  | { type: "error"; message: string; code?: string };

/** Public, non-secret capacity info from GET /api/usage. */
export type UsageInfo = {
  signedIn: boolean;
  email: string | null;
  guest: boolean;
  /** owner: a private username/password login. guest: one-click, no-email sessions. */
  signInMethod: "owner" | "guest";
  localMode: boolean;
  provider: { id: string; label: string; model: string };
  liveEnabled: boolean;
  compact: { available: boolean; reason: string | null };
  full: { available: boolean };
  limits: { user: number; global: number; maxInputChars: number };
  used: { user: number; global: number };
  remaining: number;
  resetAt: string;
  turnstileSiteKey: string | null;
};
