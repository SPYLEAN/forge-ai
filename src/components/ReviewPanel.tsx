"use client";

import { useState } from "react";
import type { Lesson, Mission } from "@/lib/types";
import { Button, Notice, Spark, inputClass } from "./ui";

type ReviewResult = { mission: Mission; lessons: Lesson[]; learnError: string | null };

/** The Verify → Learn step: the user judges the result and teaches the partner. */
export function ReviewPanel({
  mission,
  partnerName,
  learned,
  onReviewed,
  onReforge,
}: {
  mission: Mission;
  partnerName: string;
  learned: Lesson[];
  onReviewed: (r: ReviewResult) => void;
  onReforge?: (brief: string) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [learnError, setLearnError] = useState<string | null>(null);

  async function review(verdict: "approve" | "reject") {
    setBusy(verdict);
    setError(null);
    try {
      const res = await fetch(`/api/missions/${mission.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict, feedback }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Review failed.");
      setLearnError(data.learnError);
      onReviewed(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed.");
    } finally {
      setBusy(null);
    }
  }

  if (mission.status === "approved" || mission.status === "rejected") {
    const approved = mission.status === "approved";
    return (
      <section aria-label="Review outcome" className="rounded-xl border border-line bg-card p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 font-mono text-[11px] ${approved ? "bg-volt" : "bg-bad/10 text-bad"}`}
          >
            {approved ? "✓ Approved" : "✕ Rejected"}
          </span>
          {mission.feedback && <span className="text-sm text-ink-2 truncate">“{mission.feedback}”</span>}
        </div>
        {learnError && (
          <Notice tone="warn">
            Couldn&apos;t distill the feedback ({learnError}), so it was saved word for word as a lesson.
          </Notice>
        )}
        {learned.length > 0 ? (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 mb-2">
              {partnerName} learned
            </div>
            <ul className="flex flex-col gap-1.5">
              {learned.map((l) => (
                <li key={l.id} className="flex gap-2 text-sm">
                  <Spark size={12} />
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-ink-3">No new lessons from this review.</p>
        )}
        {!approved && onReforge && (
          <Button
            variant="ghost"
            className="self-start"
            onClick={() =>
              onReforge(`${mission.brief}\n\nCorrection from the last attempt: ${mission.feedback ?? ""}`)
            }
          >
            Re-forge with this correction
          </Button>
        )}
      </section>
    );
  }

  if (mission.status !== "awaiting_review") return null;

  return (
    <section aria-label="Review" className="rounded-xl border-2 border-ink bg-card p-5 flex flex-col gap-4">
      <div>
        <h2 className="font-display font-bold text-lg">Your verdict</h2>
        <p className="text-sm text-ink-2 mt-0.5">
          Approve or correct the result. Your feedback becomes a lesson {partnerName} applies to every future mission.
        </p>
      </div>
      <label htmlFor="feedback" className="sr-only">
        Feedback
      </label>
      <textarea
        id="feedback"
        className={`${inputClass} min-h-24 resize-y`}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="e.g. Don't use useEffect for data fetching. Use server components. Also, error messages must say how to recover."
        maxLength={500}
      />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => review("approve")} disabled={busy !== null}>
          {busy === "approve" ? "Saving…" : feedback.trim() ? "Approve & teach" : "Approve"}
        </Button>
        <Button
          variant="danger"
          onClick={() => review("reject")}
          disabled={busy !== null || !feedback.trim()}
          title={feedback.trim() ? undefined : "Write what should change first"}
        >
          {busy === "reject" ? "Learning…" : "Reject & correct"}
        </Button>
      </div>
      {!feedback.trim() && (
        <p className="text-xs text-ink-3">To reject, write what should change. That&apos;s how {partnerName} learns.</p>
      )}
    </section>
  );
}
