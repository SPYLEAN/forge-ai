import Image from "next/image";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ComponentProps, ReactNode } from "react";

export function Mark({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/forge-mark.png"
      alt=""
      width={size}
      height={size}
      className={className}
      priority
    />
  );
}

/** The coral four-point star from the center of the mark. */
export function Spark({ live = false, size = 14 }: { live?: boolean; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      className={live ? "spark-live" : undefined}
    >
      <path
        d="M12 0C13 8 16 11 24 12C16 13 13 16 12 24C11 16 8 13 0 12C8 11 11 8 12 0Z"
        fill="var(--spark)"
      />
    </svg>
  );
}

export function Wordmark({ name }: { name?: string }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 group" aria-label="FORGE AI home">
      <Mark size={34} />
      <span className="font-display font-extrabold tracking-tight text-lg leading-none">
        FORGE<span className="text-ink-3 font-medium"> AI</span>
      </span>
      {name && (
        <span className="hidden sm:inline font-mono text-xs text-ink-3 border-l border-line pl-2.5 ml-0.5">
          {name}
        </span>
      )}
    </Link>
  );
}

type ButtonProps = ComponentProps<"button"> & { variant?: "primary" | "ghost" | "danger" };

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  const styles = {
    primary:
      "bg-ink text-paper hover:bg-ink-2 disabled:bg-ink-3 shadow-[3px_3px_0_var(--volt)] hover:shadow-[1px_1px_0_var(--volt)] hover:translate-x-[2px] hover:translate-y-[2px] disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0",
    ghost: "bg-transparent text-ink border border-line hover:border-ink hover:bg-card",
    danger: "bg-transparent text-bad border border-line hover:border-bad",
  }[variant];
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-card px-3.5 py-2.5 text-[15px] placeholder:text-ink-3 focus:border-ink focus:outline-none focus:ring-0 transition-colors";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-forge">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "warn";
  children: ReactNode;
}) {
  const s = {
    info: "border-line bg-card text-ink-2",
    warn: "border-spark/40 bg-spark/5 text-ink",
    error: "border-bad/40 bg-bad/5 text-bad",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${s}`}>
      {children}
    </div>
  );
}

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}
