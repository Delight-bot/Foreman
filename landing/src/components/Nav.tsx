import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Button, LinkButton } from "./ui";

const links = [
  { href: "#product", label: "Product" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#trust", label: "Trust & verification" },
  { href: "#architecture", label: "Architecture" },
];

export function Nav({ onDemo }: { onDemo: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sticky top-0 z-40 border-b border-rule bg-paper/95 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-6" aria-label="Main">
        <a href="#top" className="flex items-center gap-2.5 text-[20px] font-semibold tracking-tight">
          <Wordmark />
          Foreman
        </a>
        <div className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="text-[15px] text-ink-2 hover:text-ink">
              {l.label}
            </a>
          ))}
          <Button onClick={onDemo} className="py-2.5">Request a demo</Button>
        </div>
        <button
          className="md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <X /> : <Menu />}
        </button>
      </nav>
      {open && (
        <div className="border-t border-rule px-6 pb-6 md:hidden">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="block py-3 text-[16px]" onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          <LinkButton href="#demo" onClick={() => setOpen(false)} className="mt-2 w-full">
            Request a demo
          </LinkButton>
        </div>
      )}
    </div>
  );
}

function Wordmark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="2" y="2" width="24" height="24" rx="5" fill="#1b2028" />
      <path d="M8 20V8h11M8 14h8" stroke="#f3f1ec" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="21" cy="21" r="3" fill="#e5682b" />
    </svg>
  );
}
