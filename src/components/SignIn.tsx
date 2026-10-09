"use client";

import { useState } from "react";
import { Button, Notice, inputClass } from "./ui";

/** Magic-link sign-in. In local dev without Supabase it becomes a named dev identity. */
export function SignIn({ localMode, onSignedIn }: { localMode: boolean; onSignedIn: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("signin") === "failed"
      ? "That sign-in link was invalid or expired. Request a new one."
      : null,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(localMode ? "/api/auth/dev" : "/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(localMode ? { name: value } : { email: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Sign-in failed.");
      if (localMode) onSignedIn();
      else setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Notice>
        Check <strong>{value}</strong> for a sign-in link. It works once and expires after an hour.
      </Notice>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label htmlFor="signin" className="text-sm font-semibold">
        {localMode ? "Local dev sign-in: pick a username" : "Sign in with your email"}
      </label>
      <div className="flex gap-2">
        <input
          id="signin"
          type={localMode ? "text" : "email"}
          autoComplete={localMode ? "off" : "email"}
          className={inputClass}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={localMode ? "e.g. alice" : "you@school.edu"}
          required
        />
        <Button type="submit" disabled={busy || !value.trim()}>
          {busy ? "…" : localMode ? "Enter" : "Send link"}
        </Button>
      </div>
      {localMode && (
        <p className="text-xs text-ink-3">
          Development only. Supabase isn&apos;t configured, so there&apos;s no password. This form doesn&apos;t exist on a deployed site.
        </p>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </form>
  );
}
