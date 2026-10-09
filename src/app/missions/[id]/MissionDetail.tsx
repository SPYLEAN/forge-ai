"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Lesson, Mission } from "@/lib/types";
import { MissionView, statesFromOutputs } from "@/components/MissionView";
import { ReviewPanel } from "@/components/ReviewPanel";
import { STATUS_LABEL, Shell } from "@/components/Shell";
import { Provenance } from "@/components/Usage";
import { Notice, Spark, timeAgo } from "@/components/ui";

type Data = { mission: Mission; applied: Lesson[]; learned: Lesson[] };

export function MissionDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [partnerName, setPartnerName] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, p] = await Promise.all([fetch(`/api/missions/${id}`), fetch("/api/partner")]);
      if (m.status === 401) {
        router.replace("/");
        return;
      }
      const md = await m.json();
      if (!m.ok) throw new Error(md.error ?? "Couldn't load mission.");
      setData(md);
      setPartnerName((await p.json()).partner?.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load mission.");
    }
  }, [id, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // A mission still running (e.g. started in another tab) is polled until it settles.
  const running = data?.mission.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [running, load]);

  return (
    <Shell name={partnerName}>
      <Link href="/" className="text-sm text-ink-2 hover:text-ink self-start">
        ← All missions
      </Link>
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && (
        <div role="status" className="flex items-center gap-2 text-sm text-ink-3">
          <Spark live /> Loading mission…
        </div>
      )}
      {data && (
        <>
          <header className="flex flex-col gap-2">
            <div className="flex gap-2 font-mono text-[11px] text-ink-3">
              <span>{STATUS_LABEL[data.mission.status]}</span>
              <span>·</span>
              <span>{timeAgo(data.mission.createdAt)}</span>
              {data.applied.length > 0 && (
                <>
                  <span>·</span>
                  <span>
                    {data.applied.length} lesson{data.applied.length === 1 ? "" : "s"} applied
                  </span>
                </>
              )}
            </div>
            <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight whitespace-pre-wrap">
              {data.mission.brief}
            </h1>
          </header>
          <Provenance kind={data.mission.mode} />
          {running && (
            <Notice>
              <span className="inline-flex items-center gap-2">
                <Spark live /> Still forging. This page refreshes on its own.
              </span>
            </Notice>
          )}
          {data.mission.error && <Notice tone="error">{data.mission.error}</Notice>}
          <MissionView
            outputs={data.mission.outputs}
            states={statesFromOutputs(data.mission.outputs, data.mission.status === "failed")}
            live={false}
            gates={data.mission.gates}
          />
          <ReviewPanel
            mission={data.mission}
            partnerName={partnerName ?? "Your partner"}
            learned={data.learned}
            onReviewed={({ mission, lessons }) => setData((d) => (d ? { ...d, mission, learned: lessons } : d))}
            onReforge={(brief) => {
              sessionStorage.setItem("forge:draft", brief);
              router.push("/");
            }}
          />
        </>
      )}
    </Shell>
  );
}
