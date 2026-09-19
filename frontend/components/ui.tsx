"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleX, LoaderCircle, ShieldAlert } from "lucide-react";
import type { Confidence, PageStatus } from "@/lib/api";

type Variant = "primary" | "secondary" | "quiet" | "orange";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-orange disabled:hover:bg-ink",
  orange: "bg-orange text-paper hover:bg-ink disabled:hover:bg-orange",
  secondary: "border-[1.5px] border-ink text-ink hover:border-orange hover:text-orange bg-paper-2",
  quiet: "text-ink hover:text-orange px-2",
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
    <div role="alert" className="flex items-start gap-2 rounded-md border-[1.5px] border-orange bg-orange/10 px-3 py-2.5 text-[14px]">
      <CircleAlert size={17} className="mt-0.5 shrink-0 text-orange" />
      <span>{children}</span>
    </div>
  );
}

const pageStatus: Record<PageStatus, { label: string; cls: string }> = {
  verified: { label: "Verified", cls: "bg-ok text-paper" },
  unverified: { label: "Unverified", cls: "bg-warn text-paper" },
  quarantined: { label: "Quarantined", cls: "bg-orange text-paper" },
  rejected: { label: "Rejected", cls: "bg-ink-2 text-paper" },
};

export function StatusPill({ status }: { status: PageStatus }) {
  const s = pageStatus[status];
  return <span className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] tracking-[0.06em] uppercase ${s.cls}`}>{s.label}</span>;
}

const confidence: Record<Confidence, { icon: typeof CircleCheck; title: string; body: string; cls: string }> = {
  verified: {
    icon: CircleCheck,
    title: "Verified source",
    body: "Every step is taken from a verified page. Tap a citation to see it.",
    cls: "border-ok text-ok",
  },
  unverified: {
    icon: ShieldAlert,
    title: "Unverified page",
    body: "Part of this answer comes from a machine-read scan. Check the original before acting.",
    cls: "border-warn text-warn",
  },
  not_found: {
    icon: CircleX,
    title: "Not in the documents",
    body: "Foreman does not invent procedures. Here is what is missing and the closest page.",
    cls: "border-ink text-ink",
  },
};

export function ConfidenceBanner({ value }: { value: Confidence }) {
  const c = confidence[value];
  const Icon = c.icon;
  return (
    <div className={`flex items-start gap-2.5 rounded-md border-[1.5px] bg-paper-2 px-3 py-2.5 ${c.cls}`}>
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div>
        <div className="text-[14px] font-semibold">{c.title}</div>
        <div className="text-[13px] text-ink-2">{c.body}</div>
      </div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border-[1.5px] border-ink/80 bg-paper-2 ${className}`}>{children}</div>;
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
  "w-full rounded-md border-[1.5px] border-ink/70 bg-paper-2 px-3 py-2 text-[15px] placeholder:text-ink-2/70 focus:border-orange focus:outline-none";

export function when(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
