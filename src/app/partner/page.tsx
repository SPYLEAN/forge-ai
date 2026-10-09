"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Lesson, Partner } from "@/lib/types";
import { ImprintForm } from "@/components/ImprintForm";
import { Shell } from "@/components/Shell";
import { Button, Notice, Spark, inputClass, timeAgo } from "@/components/ui";

const SOURCE_LABEL: Record<Lesson["source"], string> = {
  correction: "from a correction",
  approval: "from an approval",
  manual: "taught directly",
};

export default function PartnerPage() {
  const router = useRouter();
  const [partner, setPartner] = useState<Partner | null | undefined>(undefined);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/partner");
      if (res.status === 401) {
        router.replace("/");
        return;
      }
      if (!res.ok) throw new Error("Couldn't load your partner.");
      const data = await res.json();
      setPartner(data.partner);
      setLessons(data.lessons);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your partner.");
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function addLesson(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/lessons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't add lesson.");
      setLessons((l) => [data.lesson, ...l]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add lesson.");
    } finally {
      setAdding(false);
    }
  }

  async function forget(id: string) {
    const prev = lessons;
    setLessons((l) => l.filter((x) => x.id !== id));
    const res = await fetch(`/api/lessons?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setLessons(prev);
      setError("Couldn't forget that lesson. Try again.");
    }
  }

  if (partner === null) {
    return (
      <Shell>
        <Notice>
          No partner yet. <Link href="/" className="underline">Imprint one first.</Link>
        </Notice>
      </Shell>
    );
  }

  return (
    <Shell name={partner?.name}>
      {error && <Notice tone="error">{error}</Notice>}
      {partner === undefined ? (
        <div role="status" className="flex items-center gap-2 text-sm text-ink-3">
          <Spark live /> Loading…
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-10 items-start">
          <section>
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-spark mb-1">Imprint</p>
            <h1 className="font-display font-extrabold text-3xl tracking-tight mb-6">Who {partner.name} is</h1>
            <ImprintForm initial={partner} onSaved={setPartner} />
          </section>

          <section>
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-spark mb-1">Memory</p>
            <h2 className="font-display font-extrabold text-3xl tracking-tight mb-2">What {partner.name} has learned</h2>
            <p className="text-sm text-ink-2 mb-5">
              The lessons most relevant to each mission (up to 10 for Compact Swarm) go into the specialists&apos; instructions. Forget
              anything that&apos;s wrong or out of date.
            </p>
            <form onSubmit={addLesson} className="flex gap-2 mb-5">
              <label htmlFor="lesson" className="sr-only">
                New lesson
              </label>
              <input
                id="lesson"
                className={inputClass}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Teach a rule directly, e.g. Use pnpm, never npm."
                maxLength={500}
              />
              <Button type="submit" disabled={adding || draft.trim().length < 3}>
                Teach
              </Button>
            </form>
            {lessons.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line p-6 text-sm text-ink-3 text-center">
                No lessons yet. Review a mission&apos;s result and your feedback will show up here.
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {lessons.map((l) => (
                  <li key={l.id} className="group rounded-lg border border-line bg-card px-4 py-3 flex gap-3 items-start">
                    <span className="mt-1 shrink-0">
                      <Spark size={12} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px]">{l.text}</p>
                      <p className="font-mono text-[10px] text-ink-3 mt-1">
                        {SOURCE_LABEL[l.source]} · {timeAgo(l.createdAt)}
                        {l.missionId && (
                          <>
                            {" · "}
                            <Link href={`/missions/${l.missionId}`} className="underline">
                              mission
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => forget(l.id)}
                      className="text-xs text-ink-3 hover:text-bad px-2 py-1 rounded"
                      aria-label={`Forget lesson: ${l.text}`}
                    >
                      Forget
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Shell>
  );
}
