"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AGENTS,
  type AgentRole,
  type Lesson,
  type Mission,
  type MissionEvent,
  type MissionMode,
  type Partner,
  type UsageInfo,
} from "@/lib/types";
import { DemoPlayer } from "./DemoPlayer";
import { ImprintForm } from "./ImprintForm";
import { MissionView, type StationState } from "./MissionView";
import { ReviewPanel } from "./ReviewPanel";
import { STATUS_LABEL, Shell } from "./Shell";
import { SignIn } from "./SignIn";
import { Turnstile } from "./Turnstile";
import { CapacityState, FREE_NOTICE, Provenance, UsageStrip } from "./Usage";
import { Button, Mark, Notice, Spark, inputClass, timeAgo } from "./ui";

type Run = {
  mode: Exclude<MissionMode, "demo">;
  mission: Mission | null;
  outputs: Partial<Record<AgentRole, string>>;
  states: Record<AgentRole, StationState>;
  running: boolean;
  error: string | null;
  errorCode: string | null;
  learned: Lesson[];
};

type Limit = { title: string; message: string; resetAt?: string };

const idleStates = () => Object.fromEntries(AGENTS.map((a) => [a, "waiting"])) as Record<AgentRole, StationState>;

export function Workspace() {
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [partner, setPartner] = useState<Partner | null | undefined>(undefined);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const u = await fetch("/api/usage", { cache: "no-store" });
      if (!u.ok) throw new Error("The server returned an error.");
      const info = (await u.json()) as UsageInfo;
      setUsage(info);
      if (info.signedIn) {
        const [p, m] = await Promise.all([fetch("/api/partner"), fetch("/api/missions")]);
        if (!p.ok || !m.ok) throw new Error("Couldn't load your workspace.");
        const pd = await p.json();
        setPartner(pd.partner);
        setLessons(pd.lessons);
        setMissions(await m.json());
      } else {
        setPartner(null);
      }
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load your workspace.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  if (loadError) {
    return (
      <Shell>
        <div className="max-w-md mx-auto mt-24 flex flex-col gap-4">
          <Notice tone="error">{loadError}</Notice>
          <Button variant="ghost" onClick={refresh}>
            Try again
          </Button>
        </div>
      </Shell>
    );
  }

  if (!usage || partner === undefined) {
    return (
      <Shell>
        <div className="flex-1 grid place-items-center text-ink-3 text-sm" role="status">
          <div className="flex items-center gap-2">
            <Spark live /> Lighting the forge…
          </div>
        </div>
      </Shell>
    );
  }

  if (!usage.signedIn) return <Landing usage={usage} onSignedIn={refresh} />;
  if (!partner) return <Onboarding account={usage} onSaved={refresh} />;

  return (
    <Main
      usage={usage}
      partner={partner}
      lessons={lessons}
      missions={missions}
      refresh={refresh}
    />
  );
}

// ---------------------------------------------------------------------------
// Signed-in workspace: Demo | Compact Swarm | Full Swarm
// ---------------------------------------------------------------------------

function Main({
  usage,
  partner,
  lessons,
  missions,
  refresh,
}: {
  usage: UsageInfo;
  partner: Partner;
  lessons: Lesson[];
  missions: Mission[];
  refresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState<MissionMode>(usage.compact.available ? "compact" : "demo");
  const [brief, setBrief] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [limit, setLimit] = useState<Limit | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [challenge, setChallenge] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // "Re-forge with this correction" from a mission page hands its draft over here.
    try {
      const draft = sessionStorage.getItem("forge:draft");
      if (draft) {
        setBrief(draft);
        sessionStorage.removeItem("forge:draft");
      }
    } catch {
      // Storage unavailable (private mode); the user can paste the brief instead.
    }
    return () => abortRef.current?.abort();
  }, []);

  const lessonsById = new Map(lessons.map((l) => [l.id, l]));
  const needsTurnstile = Boolean(usage.turnstileSiteKey);
  const maxChars = usage.limits.maxInputChars;
  const liveMode = tab === "full" ? "full" : "compact";

  async function forge(e: React.FormEvent) {
    e.preventDefault();
    if (brief.trim().length < 10 || run?.running) return;
    if (needsTurnstile && !token) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setLimit(null);
    setRun({
      mode: liveMode,
      mission: null,
      outputs: {},
      states: idleStates(),
      running: true,
      error: null,
      errorCode: null,
      learned: [],
    });
    const patch = (fn: (r: Run) => Run) => setRun((r) => (r ? fn(r) : r));

    try {
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief, mode: liveMode, turnstileToken: token ?? undefined }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429 || data.fallback === "demo") {
          setRun(null);
          setLimit({
            title: data.code === "global_limit" ? "Today’s free capacity has been used" : "You’ve used today’s free live mission",
            message: data.error,
            resetAt: data.resetAt,
          });
          return;
        }
        throw new Error(data.error ?? `Request failed (${res.status}).`);
      }
      setBrief("");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          patch((r) => applyEvent(r, JSON.parse(line) as MissionEvent));
        }
      }
      patch((r) => ({ ...r, running: false }));
    } catch (err) {
      if (controller.signal.aborted) return;
      patch((r) => ({ ...r, running: false, error: err instanceof Error ? err.message : "Forging failed." }));
    } finally {
      // Turnstile tokens are single-use.
      setChallenge((c) => c + 1);
      refresh();
    }
  }

  const tabs: { id: MissionMode; label: string; sub: string; disabled?: boolean }[] = [
    { id: "demo", label: "Interactive demo", sub: "Pre-written · unlimited" },
    {
      id: "compact",
      label: "Compact Swarm",
      sub: usage.compact.available ? `Live · ${usage.remaining} left today` : "Live · unavailable now",
    },
    { id: "full", label: "Full Swarm", sub: usage.full.available ? "Local dev · your key" : "Off on this deployment" },
  ];

  const showLiveComposer =
    !run?.running && !limit && ((tab === "compact" && usage.compact.available) || (tab === "full" && usage.full.available));

  return (
    <Shell name={partner.name} account={usage}>
      <p className="text-sm text-ink-2 -mb-2">{FREE_NOTICE}</p>
      <UsageStrip usage={usage} />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-8 items-start">
        <div className="flex flex-col gap-6 min-w-0">
          <div role="tablist" aria-label="Mission mode" className="grid grid-cols-3 gap-1 rounded-xl bg-paper-2 p-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => {
                  setTab(t.id);
                  setLimit(null);
                }}
                disabled={run?.running}
                className={`rounded-lg px-2 sm:px-3 py-2 text-left transition-colors ${
                  tab === t.id ? "bg-card shadow-sm" : "hover:bg-card/60"
                }`}
              >
                <div className="font-semibold text-[13px] sm:text-sm leading-tight">{t.label}</div>
                <div className="text-[11px] text-ink-3 mt-0.5 hidden sm:block">{t.sub}</div>
              </button>
            ))}
          </div>

          {tab === "demo" && (
            <DemoPlayer
              footer={
                <Notice>
                  Demo results can&apos;t be reviewed or saved. Run a live mission to teach {partner.name} with your own
                  feedback.
                </Notice>
              }
            />
          )}

          {tab !== "demo" && limit && (
            <CapacityState
              title={limit.title}
              message={limit.message}
              resetAt={limit.resetAt}
              onDemo={() => {
                setLimit(null);
                setTab("demo");
              }}
            />
          )}

          {tab === "compact" && !usage.compact.available && !limit && !run && (
            <CapacityState
              title={
                usage.used.global >= usage.limits.global
                  ? "Today’s free capacity has been used"
                  : usage.remaining <= 0
                    ? "You’ve used today’s free live mission"
                    : "Live missions are resting"
              }
              message={`${usage.compact.reason ?? ""} The interactive demo is always available and unlimited.`}
              resetAt={usage.liveEnabled ? usage.resetAt : undefined}
              onDemo={() => setTab("demo")}
            />
          )}

          {tab === "full" && !usage.full.available && (
            <div className="rounded-xl border border-line bg-card p-6 flex flex-col gap-2">
              <h2 className="font-display font-extrabold text-xl">Full Swarm is off on this deployment</h2>
              <p className="text-sm text-ink-2">
                Full Swarm runs four separate specialist calls on a paid model, so it&apos;s never offered with a shared key.
                It only runs in local development when a developer sets <code className="font-mono">ANTHROPIC_ENABLED=true</code>{" "}
                with their own key. Use Compact Swarm or the demo instead.
              </p>
            </div>
          )}

          {showLiveComposer && (
            <form onSubmit={forge} className="flex flex-col gap-3">
              <label htmlFor="brief" className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight">
                What should {partner.name} build?
              </label>
              <p className="text-sm text-ink-2 -mt-1">
                {tab === "compact"
                  ? `Compact Swarm: one free model request writes all four specialist perspectives. Short answers, ${
                      usage.limits.user === 1 ? "one mission a day" : `${usage.limits.user} missions a day`
                    }.`
                  : "Full Swarm: four separate Claude calls on your own key (paid by you)."}
              </p>
              <textarea
                id="brief"
                ref={composerRef}
                className={`${inputClass} min-h-28 resize-y text-base`}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
                }}
                placeholder="e.g. Add rate limiting to our Next.js API routes. 20 req/min per IP, a friendly 429 response, and it has to work on Vercel."
                maxLength={maxChars}
                aria-describedby="brief-count"
              />
              <div id="brief-count" className="text-xs text-ink-3 -mt-1 text-right font-mono">
                {brief.length.toLocaleString()} / {maxChars.toLocaleString()}
              </div>
              {needsTurnstile && usage.turnstileSiteKey && (
                <Turnstile siteKey={usage.turnstileSiteKey} onToken={setToken} resetKey={challenge} />
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={brief.trim().length < 10 || (needsTurnstile && !token)}>
                  {tab === "compact" ? `Run live mission (${usage.remaining} left today)` : "Run Full Swarm"}
                </Button>
                <span className="text-xs text-ink-3">
                  {lessons.length > 0
                    ? `${Math.min(lessons.length, tab === "compact" ? 10 : 25)} learned lesson${lessons.length === 1 ? "" : "s"} will be applied`
                    : "No lessons yet. Review results to teach your partner."}
                </span>
              </div>
            </form>
          )}

          {run && tab !== "demo" && (
            <div className="flex flex-col gap-5">
              <Provenance kind={run.mode} model={run.mode === "compact" ? usage.provider.model : undefined} />
              {run.running && run.mode === "compact" && (
                <p role="status" className="text-sm text-ink-2 flex items-center gap-2">
                  <Spark live /> One model is writing all four perspectives. This usually takes 10–30 seconds.
                </p>
              )}
              {run.error && (
                <Notice tone="error">
                  {run.error}
                  {run.errorCode === "provider_capacity" ? " Try the interactive demo in the meantime." : ""} This attempt
                  counted toward today&apos;s limit and was not retried.
                </Notice>
              )}
              {run.mission?.appliedLessonIds.length ? (
                <AppliedLessons
                  lessons={run.mission.appliedLessonIds.map((id) => lessonsById.get(id)).filter((l): l is Lesson => !!l)}
                />
              ) : null}
              <MissionView outputs={run.outputs} states={run.states} live={run.running} gates={run.mission?.gates} />
              {run.error && (
                <Button variant="ghost" className="self-start" onClick={() => setTab("demo")}>
                  Explore the interactive demo
                </Button>
              )}
              {run.mission && !run.running && !run.error && (
                <ReviewPanel
                  mission={run.mission}
                  partnerName={partner.name}
                  learned={run.learned}
                  onReviewed={({ mission, lessons: learned }) => {
                    setRun((r) => (r ? { ...r, mission, learned } : r));
                    refresh();
                  }}
                  onReforge={(b) => {
                    setBrief(b);
                    setRun(null);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                    composerRef.current?.focus();
                  }}
                />
              )}
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-6 lg:sticky lg:top-6">
          <PartnerCard partner={partner} lessons={lessons} />
          <MissionList missions={missions} />
        </aside>
      </div>
    </Shell>
  );
}

function applyEvent(r: Run, ev: MissionEvent): Run {
  switch (ev.type) {
    case "mission":
      return { ...r, mission: ev.mission };
    case "agent_start":
      return { ...r, states: { ...r.states, [ev.agent]: "thinking" } };
    case "delta":
      return {
        ...r,
        outputs: { ...r.outputs, [ev.agent]: (r.outputs[ev.agent] ?? "") + ev.text },
        states: { ...r.states, [ev.agent]: "writing" },
      };
    case "section":
      return { ...r, outputs: { ...r.outputs, [ev.agent]: ev.text } };
    case "agent_done":
      return {
        ...r,
        outputs: { ...r.outputs, [ev.agent]: r.outputs[ev.agent] ?? "" },
        states: { ...r.states, [ev.agent]: "done" },
      };
    case "done":
      return { ...r, mission: ev.mission, running: false };
    case "error": {
      const states = { ...r.states };
      for (const a of AGENTS) if (states[a] === "thinking" || states[a] === "writing") states[a] = "failed";
      return { ...r, states, running: false, error: ev.message, errorCode: ev.code ?? null };
    }
    default:
      return r;
  }
}

// ---------------------------------------------------------------------------
// Anonymous landing: unlimited demo plus sign-in for the daily live mission
// ---------------------------------------------------------------------------

function Landing({ usage, onSignedIn }: { usage: UsageInfo; onSignedIn: () => void }) {
  const owner = usage.signInMethod === "owner";
  return (
    <Shell>
      <section className="grid lg:grid-cols-[1.2fr_1fr] gap-8 items-center">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-spark mb-3">
            Imprint → Assign → Orchestrate → Verify → Learn
          </p>
          <h1 className="font-display font-extrabold text-4xl sm:text-6xl leading-[0.95] tracking-tight">
            Intelligence, forged around you.
          </h1>
          <p className="mt-4 text-ink-2 max-w-lg">
            Build an AI coding partner that learns how you think. An Architect, a Builder, a Critic and a Witness work
            each mission, and your reviews teach it what you expect.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-card p-5 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Mark size={40} />
            <div>
              <div className="font-display font-bold">
                {owner ? "Sign in to your workspace" : "One free live mission a day"}
              </div>
              <div className="text-xs text-ink-3">
                {owner ? "Private workspace. No payment details, ever." : "No email, no password, no payment details."}
              </div>
            </div>
          </div>
          <SignIn method={usage.signInMethod} onSignedIn={onSignedIn} />
        </div>
      </section>
      <p className="text-sm text-ink-2">{FREE_NOTICE}</p>
      <UsageStrip usage={usage} />
      <DemoPlayer
        footer={
          <Notice>
            {owner
              ? "That was the pre-written demo. Sign in to imprint your partner and run live AI missions."
              : "That was the pre-written demo. Click Get started to imprint your own partner and run one live AI mission a day."}
          </Notice>
        }
      />
    </Shell>
  );
}

function Onboarding({ account, onSaved }: { account: UsageInfo; onSaved: () => void }) {
  return (
    <Shell account={account}>
      <div className="max-w-lg w-full mx-auto">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-spark mb-2">Step 1 · Imprint</p>
        <h1 className="font-display font-extrabold text-3xl tracking-tight mb-2">Who is your partner?</h1>
        <p className="text-ink-2 mb-8">
          Its name, its personality, and the standards you&apos;d enforce in code review. You can change all of this
          later.
        </p>
        <ImprintForm onSaved={onSaved} submitLabel="Forge my partner" />
      </div>
    </Shell>
  );
}

function PartnerCard({ partner, lessons }: { partner: Partner; lessons: Lesson[] }) {
  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-lg bg-volt grid place-items-center font-display font-extrabold text-xl">
          {partner.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="font-display font-bold text-lg leading-tight truncate">{partner.name}</div>
          <div className="text-xs text-ink-3">
            {lessons.length} lesson{lessons.length === 1 ? "" : "s"} learned
          </div>
        </div>
      </div>
      {lessons.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2 text-[13px] text-ink-2">
          {lessons.slice(0, 3).map((l) => (
            <li key={l.id} className="flex gap-2">
              <span className="mt-1 shrink-0">
                <Spark size={10} />
              </span>
              <span className="line-clamp-2">{l.text}</span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/partner" className="mt-4 inline-block text-sm font-semibold underline decoration-volt-deep underline-offset-4">
        {lessons.length > 3 ? `See all ${lessons.length} lessons` : "Edit imprint & memory"}
      </Link>
    </div>
  );
}

function MissionList({ missions }: { missions: Mission[] }) {
  if (missions.length === 0) return null;
  return (
    <div>
      <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 mb-2">History</h2>
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {missions.slice(0, 12).map((m) => (
          <li key={m.id}>
            <Link href={`/missions/${m.id}`} className="block py-2.5 px-1 hover:bg-paper-2 rounded">
              <div className="text-sm line-clamp-1">{m.brief}</div>
              <div className="flex gap-2 mt-0.5 font-mono text-[10px] text-ink-3">
                <span className={m.status === "awaiting_review" ? "text-spark" : m.status === "failed" ? "text-bad" : ""}>
                  {STATUS_LABEL[m.status]}
                </span>
                <span>·</span>
                <span>{m.mode === "compact" ? "compact" : "full"}</span>
                <span>·</span>
                <span>{timeAgo(m.createdAt)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AppliedLessons({ lessons }: { lessons: Lesson[] }) {
  if (lessons.length === 0) return null;
  return (
    <details className="rounded-lg border border-line bg-paper px-4 py-2.5 text-sm">
      <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
        {lessons.length} learned lesson{lessons.length === 1 ? "" : "s"} applied to this mission
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5 text-ink-2">
        {lessons.map((l) => (
          <li key={l.id} className="flex gap-2">
            <span className="mt-1 shrink-0">
              <Spark size={10} />
            </span>
            {l.text}
          </li>
        ))}
      </ul>
    </details>
  );
}
