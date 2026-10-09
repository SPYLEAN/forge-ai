"use client";

import { useState } from "react";
import { splitGates } from "@/lib/gates";
import { AGENTS, GATE_NAMES, type AgentRole, type GateResult, type Gates } from "@/lib/types";
import { Markdown, Spark } from "./ui";

export type StationState = "waiting" | "thinking" | "writing" | "done" | "failed";

const ROLE_META: Record<AgentRole, { title: string; job: string }> = {
  architect: { title: "Architect", job: "Plans boundaries and slices" },
  builder: { title: "Builder", job: "Writes the implementation" },
  critic: { title: "Critic", job: "Hunts for failures" },
  witness: { title: "Witness", job: "Verifies and hands off" },
};

export function MissionView({
  outputs,
  states,
  live,
  gates: gatesProp = null,
}: {
  outputs: Partial<Record<AgentRole, string>>;
  states: Record<AgentRole, StationState>;
  live: boolean;
  gates?: Gates | null;
}) {
  const active = AGENTS.find((r) => states[r] === "thinking" || states[r] === "writing");
  const lastDone = [...AGENTS].reverse().find((r) => states[r] === "done");
  const [pinned, setPinned] = useState<AgentRole | null>(null);
  // While forging, follow the active station unless the user picked one.
  const selected: AgentRole = pinned ?? active ?? (live ? "architect" : (lastDone ?? "architect"));

  const raw = outputs[selected] ?? "";
  // Gates arrive structured; older missions carried them as a fenced block in the Witness text.
  const legacy = selected === "witness" ? splitGates(raw) : { body: raw, gates: null };
  const body = legacy.body;
  const gates = selected === "witness" ? (gatesProp ?? legacy.gates) : null;
  const state = states[selected];

  return (
    <section aria-label="Agent swarm" className="flex flex-col gap-4">
      <div role="tablist" aria-label="Specialists" className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {AGENTS.map((role, i) => {
          const s = states[role];
          const isSel = role === selected;
          return (
            <button
              key={role}
              role="tab"
              aria-selected={isSel}
              aria-controls="agent-output"
              onClick={() => setPinned(role)}
              className={`relative text-left rounded-xl border px-3.5 py-3 transition-all ${
                isSel ? "border-ink bg-card shadow-[3px_3px_0_var(--ink)]" : "border-line bg-paper hover:border-ink-3"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-ink-3">0{i + 1}</span>
                <StationBadge state={s} />
              </div>
              <div className="mt-1.5 font-display font-bold text-[15px] leading-tight">
                {ROLE_META[role].title}
              </div>
              <div className="text-xs text-ink-3 mt-0.5 hidden sm:block">{ROLE_META[role].job}</div>
              {s === "done" && (
                <span aria-hidden className="absolute inset-x-3 -bottom-px h-[3px] rounded-full bg-volt" />
              )}
            </button>
          );
        })}
      </div>

      <div
        id="agent-output"
        role="tabpanel"
        aria-live={live ? "polite" : undefined}
        aria-busy={state === "thinking" || state === "writing"}
        className="rounded-xl border border-line bg-card p-5 sm:p-7 min-h-64"
      >
        {gates && <GateStrip gates={gates} />}
        {body ? (
          <Markdown>{body}</Markdown>
        ) : (
          <EmptyStation role={selected} state={state} />
        )}
        {state === "writing" && (
          <span className="inline-block w-2 h-4 bg-ink align-middle animate-pulse ml-0.5" aria-hidden />
        )}
      </div>
    </section>
  );
}

function StationBadge({ state }: { state: StationState }) {
  switch (state) {
    case "thinking":
      return (
        <span className="flex items-center gap-1 font-mono text-[10px] text-spark">
          <Spark live size={11} /> thinking
        </span>
      );
    case "writing":
      return (
        <span className="flex items-center gap-1 font-mono text-[10px] text-spark">
          <Spark live size={11} /> writing
        </span>
      );
    case "done":
      return <span className="font-mono text-[10px] text-ok">✓ done</span>;
    case "failed":
      return <span className="font-mono text-[10px] text-bad">✕ failed</span>;
    default:
      return <span className="font-mono text-[10px] text-ink-3">waiting</span>;
  }
}

function EmptyStation({ role, state }: { role: AgentRole; state: StationState }) {
  const title = ROLE_META[role].title;
  const msg =
    state === "thinking"
      ? `${title} is reasoning before it writes…`
      : state === "failed"
        ? `${title} didn't finish.`
        : state === "waiting"
          ? `${title} starts once the previous specialist hands off.`
          : `${title} produced no output.`;
  return (
    <div className="h-52 flex flex-col items-center justify-center gap-3 text-center text-ink-3 text-sm">
      {state === "thinking" && <Spark live size={22} />}
      <p>{msg}</p>
    </div>
  );
}

function GateStrip({ gates }: { gates: Gates }) {
  const tone: Record<GateResult, string> = {
    pass: "bg-volt border-volt-deep text-ink",
    fail: "bg-bad/10 border-bad/40 text-bad",
    unverified: "bg-paper border-line text-ink-2",
  };
  const icon: Record<GateResult, string> = { pass: "✓", fail: "✕", unverified: "?" };
  return (
    <div className="mb-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 mb-2">
        Quality gates · desk-checked, not executed
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {GATE_NAMES.map((g) => {
          const r: GateResult = gates[g] ?? "unverified";
          return (
            <li
              key={g}
              className={`rounded-full border px-2.5 py-1 font-mono text-[11px] capitalize ${tone[r]}`}
              title={`${g}: ${r}`}
            >
              <span aria-hidden>{icon[r]} </span>
              {g}
              <span className="sr-only">: {r}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function statesFromOutputs(
  outputs: Partial<Record<AgentRole, string>>,
  failed: boolean,
): Record<AgentRole, StationState> {
  const states = {} as Record<AgentRole, StationState>;
  let marked = false;
  for (const r of AGENTS) {
    if (outputs[r] !== undefined) states[r] = "done";
    else if (failed && !marked) {
      states[r] = "failed";
      marked = true;
    } else states[r] = "waiting";
  }
  return states;
}
