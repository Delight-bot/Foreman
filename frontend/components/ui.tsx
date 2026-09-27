"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleX, LoaderCircle, ShieldAlert } from "lucide-react";
import type { Confidence, PageStatus } from "@/lib/api";

type Variant = "primary" | "secondary" | "quiet" | "orange";

const base =
  "inline-flex min-h-[42px] items-center justify-center gap-2 rounded-md px-4 text-[15px] font-semibold " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-45";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-orange-deep disabled:hover:bg-ink",
  orange: "bg-orange text-paper hover:bg-orange-deep disabled:hover:bg-orange",
  secondary: "border border-ink/25 bg-paper-2 text-ink hover:border-orange hover:text-orange-deep",
  quiet: "text-ink-2 hover:text-orange-deep px-2",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[11px] tracking-[0.08em] uppercase ${className}`}>{children}</span>;
}

export function Spinner({ size = 18, className = "" }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={`spin ${className}`} aria-hidden="true" />;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border-[1.5px] border-danger bg-danger/8 px-3 py-2.5 text-[14px]">
      <CircleAlert size={17} className="mt-0.5 shrink-0 text-danger" />
      <span>{children}</span>
    </div>
  );
}

const pageStatus: Record<PageStatus, { label: string; cls: string }> = {
  verified: { label: "Verified", cls: "bg-ok text-paper" },
  unverified: { label: "Unverified", cls: "bg-warn text-paper" },
  quarantined: { label: "Quarantined", cls: "bg-danger text-paper" },
  rejected: { label: "Rejected", cls: "bg-ink-2 text-paper" },
};

export function StatusPill({ status }: { status: PageStatus }) {
  const s = pageStatus[status];
  // A shade larger than it was: this is read at arm's length, on a phone, in a plant.
  return (
    <span className={`inline-block rounded px-2 py-[3px] font-mono text-[11px] leading-none tracking-[0.06em] uppercase ${s.cls}`}>
      {s.label}
    </span>
  );
}

const confidence: Record<Confidence, { icon: typeof CircleCheck; note: string; title: string; body: string; cls: string }> = {
  verified: {
    icon: CircleCheck,
    note: "Source check",
    title: "Verified source",
    body: "Every step is taken from a verified page. Tap a citation to see it.",
    cls: "border-l-ok text-ok",
  },
  unverified: {
    icon: ShieldAlert,
    note: "Source check",
    title: "Unverified page",
    body: "Part of this answer comes from a machine-read scan. Check the original before acting.",
    cls: "border-l-warn text-warn",
  },
  not_found: {
    icon: CircleX,
    note: "Source check",
    title: "Not in the documents",
    body: "Foreman does not invent procedures. Here is what is missing and the closest page.",
    cls: "border-l-ink text-ink",
  },
};

export function ConfidenceBanner({ value }: { value: Confidence }) {
  const c = confidence[value];
  const Icon = c.icon;
  return (
    // A notice stamped down the spine of the page, the way a filed document carries one.
    <div className={`flex items-start gap-3 rounded-md border border-ink/10 border-l-[4px] bg-paper-2 px-3.5 py-3 ${c.cls}`}>
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <Mono className="text-ink-2">{c.note}</Mono>
        <div className="mt-0.5 text-[14.5px] font-semibold">{c.title}</div>
        <div className="mt-0.5 text-[13.5px] leading-relaxed text-ink">{c.body}</div>
      </div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-ink/15 bg-paper-2 shadow-[0_1px_2px_rgba(27,32,40,0.05)] ${className}`}>
      {children}
    </div>
  );
}

export function PageTitle({ title, lede, children }: { title: string; lede?: string; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-[720px]">
        <h1 className="text-[28px] leading-tight font-semibold md:text-[34px]">{title}</h1>
        <hr className="mt-3 w-16 border-0 border-t-[3px] border-orange" />
        {lede && <p className="mt-3 text-[15px] leading-relaxed text-ink-2 md:text-base">{lede}</p>}
      </div>
      {children}
    </header>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-2">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-md border-[1.5px] border-ink/20 bg-paper-2 px-3 py-2 text-[15px] placeholder:text-ink-2/60 " +
  "transition-colors hover:border-ink/35 focus:border-orange focus:outline-none";

export function when(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
