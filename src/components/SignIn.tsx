"use client";

import { useState } from "react";
import type { UsageInfo } from "@/lib/types";
import { Button, Field, inputClass, Notice } from "./ui";

/** Owner login (username and password) or one-click guest start, depending on the deployment. */
export function SignIn({ method, onSignedIn }: { method: UsageInfo["signInMethod"]; onSignedIn: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function submit(url: string, body?: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't sign in.");
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in.");
      setBusy(false);
    }
  }

  if (method === "owner") {
    return (
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit("/api/auth/login", { username, password });
        }}
      >
        <Field label="Username" htmlFor="login-user">
          <input
            id="login-user"
            className={inputClass}
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </Field>
        <Field label="Password" htmlFor="login-pass">
          <input
            id="login-pass"
            type="password"
            className={inputClass}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" disabled={busy} className="self-start">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Button onClick={() => submit("/api/auth/guest")} disabled={busy} className="self-start">
        {busy ? "Starting…" : "Get started, no email needed"}
      </Button>
      <p className="text-xs text-ink-3">
        Your partner and missions are saved to this browser. Clearing its cookies starts you over.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
