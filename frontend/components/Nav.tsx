"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, History, Inbox as InboxIcon, Wrench } from "lucide-react";
import { api } from "@/lib/api";

const links = [
  { href: "/ask", label: "Troubleshoot", icon: Wrench },
  { href: "/library", label: "Library", icon: BookOpen },
  { href: "/inbox", label: "Escalations", icon: InboxIcon },
  { href: "/log", label: "History", icon: History },
];

type Health = { llm: boolean; model: string | null; services: Record<string, boolean> };

export function Nav() {
  const path = usePathname();
  const [openFlags, setOpenFlags] = useState(0);
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    api.flags("open").then((f) => setOpenFlags(f.length)).catch(() => undefined);
    api.health().then((h) => {
      setHealth(h);
      setOffline(false);
    }).catch(() => setOffline(true));
  }, [path]);

  const on = (href: string) => path === href || path.startsWith(href + "/");
  const down = health ? Object.entries(health.services).filter(([, ok]) => !ok).map(([k]) => k) : [];

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur">
        <nav className="mx-auto flex h-14 max-w-[1180px] items-center gap-6 px-4 md:px-6" aria-label="Main">
          <Link href="/ask" className="flex items-center gap-2 text-[18px] font-semibold tracking-tight">
            <Wordmark />
            Foreman
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={on(l.href) ? "page" : undefined}
                className={`relative rounded-md px-3 py-1.5 text-[14px] font-medium ${on(l.href) ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"}`}
              >
                {l.label}
                {l.href === "/inbox" && openFlags > 0 && <Badge n={openFlags} />}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {down.length > 0 && (
              <span title="These services are not reachable" className="font-mono text-[10.5px] tracking-[0.08em] text-orange uppercase">
                {down.join(", ")} down
              </span>
            )}
            {health && (
              <span
                title={health.llm ? `Answers are drafted by ${health.model} and checked claim by claim.` : "No API key set: steps are quoted verbatim from the best-matching procedure."}
                className={`rounded px-2 py-1 font-mono text-[10.5px] tracking-[0.08em] ${health.llm ? "bg-ink text-paper" : "border border-ink/40 text-ink-2"}`}
              >
                {health.llm ? "MODEL ON" : "EXTRACTIVE MODE"}
              </span>
            )}
            {offline && <span className="font-mono text-[10.5px] tracking-[0.08em] text-orange">SERVER OFFLINE</span>}
          </div>
        </nav>
      </header>

      {/* Thumb-reach tab bar on phones. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t-[1.5px] border-ink bg-paper pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main">
        {links.map((l) => {
          const Icon = l.icon;
          return (
            <Link key={l.href} href={l.href} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${on(l.href) ? "text-orange" : "text-ink-2"}`}>
              <Icon size={20} />
              {l.label}
              {l.href === "/inbox" && openFlags > 0 && <Badge n={openFlags} />}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function Badge({ n }: { n: number }) {
  return (
    <span className="absolute -top-1 right-0 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-orange px-1 font-mono text-[10px] text-paper">
      {n}
    </span>
  );
}

function Wordmark() {
  return (
    <svg width="26" height="26" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="2" y="2" width="24" height="24" rx="5" fill="#1b2028" />
      <path d="M8 20V8h11M8 14h8" stroke="#f3f1ec" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="21" cy="21" r="3" fill="#e5682b" />
    </svg>
  );
}
