"use client";

import Link from "next/link";
import { useState } from "react";
import type { Mission } from "@/lib/types";
import { Wordmark } from "./ui";

export const STATUS_LABEL: Record<Mission["status"], string> = {
  running: "forging",
  awaiting_review: "needs review",
  approved: "approved",
  rejected: "corrected",
  failed: "failed",
};

export function Shell({
  name,
  email,
  children,
}: {
  name?: string;
  email?: string | null;
  children: React.ReactNode;
}) {
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/auth/signout", { method: "POST" }).catch(() => null);
    // Full reload so every client-side cache of the old session is dropped.
    window.location.replace(new URL("/", window.location.origin));
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b border-line">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Wordmark name={name} />
          <nav className="flex items-center gap-1 text-sm">
            {name && (
              <>
                <Link href="/" className="px-3 py-1.5 rounded-md hover:bg-paper-2">
                  Missions
                </Link>
                <Link href="/partner" className="px-3 py-1.5 rounded-md hover:bg-paper-2 hidden sm:inline">
                  Imprint &amp; memory
                </Link>
              </>
            )}
            {email && (
              <button
                onClick={signOut}
                disabled={signingOut}
                className="px-3 py-1.5 rounded-md hover:bg-paper-2 text-ink-2"
                title={`Signed in as ${email}`}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">{children}</main>
    </div>
  );
}
