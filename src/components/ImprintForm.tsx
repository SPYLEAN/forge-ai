"use client";

import { useState } from "react";
import type { Partner } from "@/lib/types";
import { Button, Field, Notice, inputClass } from "./ui";

const STANDARDS_EXAMPLE = `TypeScript strict, no \`any\`.
Validate every API input with zod.
Small pure functions; no classes unless they hold state.
Every UI state handled: loading, empty, error.
Prefer the platform over new dependencies.`;

export function ImprintForm({
  initial,
  onSaved,
  submitLabel,
}: {
  initial?: Partner | null;
  onSaved: (p: Partner) => void;
  submitLabel?: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [personality, setPersonality] = useState(initial?.personality ?? "");
  const [standards, setStandards] = useState(initial?.standards ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/partner", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, personality, standards }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't save.");
      setSaved(true);
      onSaved(data.partner);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Field label="Name" htmlFor="name" hint="What you'll call your partner.">
        <input
          id="name"
          className={`${inputClass} font-display text-xl font-bold`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Vulcan"
          maxLength={40}
          required
          autoFocus={!initial}
        />
      </Field>
      <Field
        label="Personality"
        htmlFor="personality"
        hint="How it should think and talk. Tone, how much to push back, how it explains things."
      >
        <textarea
          id="personality"
          className={`${inputClass} min-h-24 resize-y`}
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          placeholder="Blunt senior engineer. Challenges weak ideas, explains trade-offs in one line, never pads."
          maxLength={2000}
        />
      </Field>
      <Field
        label="Coding standards & principles"
        htmlFor="standards"
        hint="Hard rules every agent must follow. One per line works best."
      >
        <textarea
          id="standards"
          className={`${inputClass} min-h-36 resize-y font-mono text-[13px]`}
          value={standards}
          onChange={(e) => setStandards(e.target.value)}
          placeholder={STANDARDS_EXAMPLE}
          maxLength={6000}
        />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving || !name.trim()}>
          {saving ? "Saving…" : (submitLabel ?? "Save imprint")}
        </Button>
        {saved && initial && (
          <span role="status" className="text-sm text-ok">
            Saved. Applies to the next mission.
          </span>
        )}
      </div>
    </form>
  );
}
