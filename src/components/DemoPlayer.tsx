"use client";

import { useEffect, useRef, useState } from "react";
import { DEMO_MISSIONS, type DemoMission } from "@/lib/demo";
import { AGENTS, type AgentRole } from "@/lib/types";
import { MissionView, type StationState } from "./MissionView";
import { Provenance } from "./Usage";
import { Button } from "./ui";

const idle = () => Object.fromEntries(AGENTS.map((a) => [a, "waiting"])) as Record<AgentRole, StationState>;

/**
 * Interactive demo: replays a pre-written mission through the four stations.
 * Unlimited, needs no account, and makes no network request at all.
 */
export function DemoPlayer({ footer }: { footer?: React.ReactNode }) {
  const [demo, setDemo] = useState<DemoMission>(DEMO_MISSIONS[0]);
  const [outputs, setOutputs] = useState<Partial<Record<AgentRole, string>>>({});
  const [states, setStates] = useState(idle);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const runId = useRef(0);

  useEffect(() => () => void runId.current++, []);

  function finish(d: DemoMission) {
    runId.current++;
    setOutputs({ ...d.outputs });
    setStates(Object.fromEntries(AGENTS.map((a) => [a, "done"])) as Record<AgentRole, StationState>);
    setPlaying(false);
    setFinished(true);
  }

  async function play(d: DemoMission) {
    const id = ++runId.current;
    setDemo(d);
    setOutputs({});
    setStates(idle());
    setFinished(false);
    setPlaying(true);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return finish(d);

    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (const role of AGENTS) {
      if (runId.current !== id) return;
      setStates((s) => ({ ...s, [role]: "thinking" }));
      await wait(450);
      const text = d.outputs[role];
      for (let i = 0; i <= text.length; i += 48) {
        if (runId.current !== id) return;
        const shown = text.slice(0, i);
        setOutputs((o) => ({ ...o, [role]: shown }));
        setStates((s) => ({ ...s, [role]: "writing" }));
        await wait(14);
      }
      setOutputs((o) => ({ ...o, [role]: text }));
      setStates((s) => ({ ...s, [role]: "done" }));
    }
    if (runId.current === id) {
      setPlaying(false);
      setFinished(true);
    }
  }

  const started = playing || finished;

  return (
    <section aria-label="Interactive demo" className="flex flex-col gap-5">
      <div>
        <h2 className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight">Pick a demo mission</h2>
        <p className="text-sm text-ink-2 mt-1">Unlimited, no account needed. Watch all four specialists hand off.</p>
      </div>
      <div className="grid sm:grid-cols-3 gap-2">
        {DEMO_MISSIONS.map((d) => (
          <button
            key={d.id}
            onClick={() => play(d)}
            aria-pressed={demo.id === d.id && started}
            className={`text-left rounded-xl border px-4 py-3 transition-all ${
              demo.id === d.id && started ? "border-ink bg-card shadow-[3px_3px_0_var(--volt)]" : "border-line hover:border-ink-3 bg-paper"
            }`}
          >
            <div className="font-display font-bold">{d.title}</div>
            <div className="text-xs text-ink-3 mt-1 line-clamp-2">{d.brief}</div>
          </button>
        ))}
      </div>

      {started && (
        <>
          <div className="flex flex-col gap-2">
            <Provenance kind="demo" />
            <p className="text-sm whitespace-pre-wrap rounded-lg bg-paper-2 px-4 py-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 block mb-1">Mission</span>
              {demo.brief}
            </p>
          </div>
          <MissionView key={demo.id} outputs={outputs} states={states} live={playing} gates={finished ? demo.gates : null} />
          <div className="flex flex-wrap items-center gap-3">
            {playing ? (
              <Button variant="ghost" onClick={() => finish(demo)}>
                Skip to the end
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => play(demo)}>
                Replay
              </Button>
            )}
          </div>
          {finished && footer}
        </>
      )}
    </section>
  );
}
