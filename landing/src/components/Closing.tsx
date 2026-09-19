import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "./ui";

export function FinalCta({ onDemo }: { onDemo: () => void }) {
  return (
    <section id="demo" className="scroll-mt-20 border-t border-rule bg-ink text-paper">
      <div className="mx-auto max-w-[1180px] px-6 py-24 md:py-32">
        <h2 className="text-[40px] leading-[1.05] font-semibold md:text-[64px]">Stop searching. Start solving.</h2>
        <hr className="mt-7 w-28 border-0 border-t-[3px] border-orange" />
        <p className="mt-7 max-w-[600px] text-[19px] leading-relaxed text-paper/80">
          Give your technicians faster access to the knowledge already inside your manuals.
        </p>
        <div className="mt-9">
          <Button onClick={onDemo} className="bg-orange text-paper hover:bg-paper hover:text-ink">Request a demo</Button>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="bg-ink text-paper/70">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-3 px-6 py-8 text-[14px] md:flex-row md:items-center md:justify-between">
        <span className="font-semibold text-paper">Foreman</span>
        <span>Multimodal maintenance intelligence for industrial troubleshooting.</span>
        <span>Prototype. Answers are only as good as the documents behind them.</span>
      </div>
    </footer>
  );
}

/**
 * Demo request dialog. The form is not connected to a backend yet: wire `onSubmit` to your
 * endpoint or mail service before launch. Until then it explains what a pilot needs.
 */
export function DemoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-title"
        className="w-full max-w-[520px] rounded-lg border-[1.5px] border-ink bg-paper p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h3 id="demo-title" className="text-[24px] font-semibold">Request a demo</h3>
          <button onClick={onClose} aria-label="Close"><X /></button>
        </div>
        {sent ? (
          <p className="mt-4 text-[16px] leading-relaxed">
            Request noted in this session only. This form is not connected yet; connect it in <code className="font-mono text-[13px]">DemoDialog.tsx</code> before launch.
          </p>
        ) : (
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setSent(true);
            }}
          >
            <p className="text-[15px] text-ink-2">
              A pilot needs one asset, its manuals and drawings, and a technician willing to try it on a real fault.
            </p>
            <Field label="Your name" name="name" />
            <Field label="Work email" name="email" type="email" />
            <Field label="Plant or facility" name="plant" />
            <Field label="One asset you would start with" name="asset" placeholder="e.g. a conveyor drive, a CNC machine, a chiller" />
            <Button type="submit" className="w-full">Send request</Button>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, name, type = "text", placeholder }: { label: string; name: string; type?: string; placeholder?: string }) {
  return (
    <label className="block text-[14px] font-semibold">
      {label}
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required
        className="mt-1.5 block w-full rounded-md border-[1.5px] border-ink bg-paper-2 px-3 py-2.5 text-[15px] font-normal placeholder:text-ink-2/60"
      />
    </label>
  );
}
