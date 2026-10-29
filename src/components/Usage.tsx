"use client";

import { useEffect, useState } from "react";
import type { UsageInfo } from "@/lib/types";
import { Button, Spark } from "./ui";

export type ProvenanceKind = "demo" | "compact" | "full";

/** Says plainly whether the specialists' output was generated just now or written in advance. */
export function Provenance({ kind, model }: { kind: ProvenanceKind; model?: string }) {
  if (kind === "demo") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-ink text-paper px-2.5 py-1 font-mono">Pre-written</span>
        <span className="font-semibold">Interactive demo</span>
        <span className="text-ink-3">These results were written in advance. No AI request ran.</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-volt border border-volt-deep px-2.5 py-1 font-mono">Generated</span>
      {kind === "compact" ? (
        <span>
          <strong>Compact Swarm</strong>: a one-model simulation of four specialist perspectives
        </span>
      ) : (
        <span>
          <strong>Full Swarm</strong>: four separate specialist calls
        </span>
      )}
      <span className="font-mono text-ink-3">
        {kind === "compact" ? "Cloudflare Workers AI" : "Anthropic Claude"}
        {model ? ` · ${model.replace(/^@cf\//, "")}` : ""}
      </span>
    </div>
  );
}

function useCountdown(iso: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - now) / 60_000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

/** Remaining missions, reset time, provider, and whether live AI is on. */
export function UsageStrip({ usage }: { usage: UsageInfo }) {
  const resetsIn = useCountdown(usage.resetAt);
  const live = usage.compact.available;
  return (
    <div className="rounded-xl border border-line bg-card px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${live ? "bg-volt-deep" : "bg-ink-3"}`} aria-hidden />
        <span className="font-semibold">{live ? "Live AI available" : "Demo mode"}</span>
      </div>
      <div>
        <span className="text-ink-3">Your live missions today </span>
        <span className="font-mono font-semibold">
          {usage.signedIn
            ? `${usage.remaining} of ${usage.limits.user} left`
            : usage.signInMethod === "owner"
              ? "sign in to use"
              : "get started for 1/day"}
        </span>
      </div>
      <div>
        <span className="text-ink-3">Resets in </span>
        <span className="font-mono">{resetsIn}</span>
        <span className="text-ink-3"> (00:00 UTC)</span>
      </div>
      <div className="text-ink-3">
        Provider{" "}
        <span className="font-mono text-ink">
          {usage.liveEnabled ? usage.provider.label : "paused"}
        </span>
      </div>
    </div>
  );
}

export const FREE_NOTICE =
  "Free AI missions are limited to protect the project’s shared allowance. You can always explore an unlimited interactive demo.";

/** Shown instead of the live composer when there's no capacity. It's a normal state, not an error. */
export function CapacityState({
  title,
  message,
  onDemo,
  resetAt,
}: {
  title: string;
  message: string;
  onDemo: () => void;
  resetAt?: string;
}) {
  const resetsIn = useCountdown(resetAt ?? new Date().toISOString());
  return (
    <div className="rounded-xl border border-line bg-card p-6 sm:p-8 flex flex-col items-start gap-3">
      <Spark size={22} />
      <h2 className="font-display font-extrabold text-2xl tracking-tight">{title}</h2>
      <p className="text-ink-2 max-w-xl">{message}</p>
      {resetAt && <p className="text-sm text-ink-3">Live missions return in {resetsIn}.</p>}
      <Button onClick={onDemo} className="mt-1">
        Explore the interactive demo
      </Button>
    </div>
  );
}
