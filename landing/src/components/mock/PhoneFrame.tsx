import type { ReactNode } from "react";

/**
 * The rugged-case phone from the presentation: thick charcoal bezel, squared corners,
 * orange corner bumpers, a small grip mark instead of a notch.
 */
export function PhoneFrame({
  children,
  chip,
  title = "Conveyor CV-12",
  subtitle = "Line 3, drive cabinet B",
  chipTone = "orange",
  clock = "9:41",
  className = "",
}: {
  children: ReactNode;
  chip?: string;
  title?: string;
  subtitle?: string;
  chipTone?: "orange" | "ink";
  clock?: string;
  className?: string;
}) {
  const chipCls = chipTone === "orange" ? "bg-orange text-paper" : "bg-ink text-paper";
  return (
    <div className={`relative w-[320px] shrink-0 select-none ${className}`} aria-label="Phone mockup">
      <div className="relative rounded-[26px] bg-ink p-[14px]">
        <Bumper pos="tl" />
        <Bumper pos="tr" />
        <Bumper pos="bl" />
        <Bumper pos="br" />
        <div className="absolute left-1/2 top-[5px] h-[4px] w-20 -translate-x-1/2 rounded bg-paper/25" />
        <div className="flex h-[640px] flex-col overflow-hidden rounded-[14px] bg-paper text-ink">
          <div className="flex h-[34px] shrink-0 items-end justify-between px-6 pb-1.5 font-mono text-[12px] font-medium">
            <span>{clock}</span>
            <span className="flex items-center gap-1.5">
              <span className="flex items-end gap-[2px]">
                <i className="block w-[3px] rounded-[1px] bg-ink" style={{ height: 4 }} />
                <i className="block w-[3px] rounded-[1px] bg-ink" style={{ height: 6 }} />
                <i className="block w-[3px] rounded-[1px] bg-ink" style={{ height: 8 }} />
                <i className="block w-[3px] rounded-[1px] bg-ink" style={{ height: 10 }} />
              </span>
              <span className="relative h-[11px] w-[22px] rounded-[3px] border-[1.5px] border-ink p-[1.5px]">
                <span className="block h-full w-[70%] rounded-[1px] bg-ink" />
              </span>
            </span>
          </div>
          <div className="flex shrink-0 items-center justify-between border-b-[1.5px] border-ink px-5 py-3">
            <div>
              <div className="font-mono text-[12px] tracking-[0.08em] uppercase">{title}</div>
              <div className="mt-0.5 text-[11px] text-ink-2">{subtitle}</div>
            </div>
            {chip && (
              <span className={`rounded-md px-2.5 py-1.5 font-mono text-[11px] tracking-[0.08em] uppercase ${chipCls}`}>
                {chip}
              </span>
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          <div className="mx-auto mb-2.5 mt-3 h-[5px] w-[110px] shrink-0 rounded bg-ink" />
        </div>
      </div>
    </div>
  );
}

function Bumper({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const map = {
    tl: "left-[-4px] top-[-4px] rounded-tl-[26px] border-r-0 border-b-0",
    tr: "right-[-4px] top-[-4px] rounded-tr-[26px] border-l-0 border-b-0",
    bl: "left-[-4px] bottom-[-4px] rounded-bl-[26px] border-r-0 border-t-0",
    br: "right-[-4px] bottom-[-4px] rounded-br-[26px] border-l-0 border-t-0",
  };
  return <span className={`absolute h-[38px] w-[38px] border-[3px] border-orange ${map[pos]}`} aria-hidden="true" />;
}

/** The persistent input bar at the bottom of every screen. */
export function AskBar() {
  return (
    <div className="mx-5 mt-3 flex items-center gap-2.5 rounded-full border-[1.5px] border-ink px-3.5 py-2.5 text-[12.5px] text-ink/85">
      <MicIcon />
      <span className="flex-1">Ask about this machine</span>
      <CameraIcon />
    </div>
  );
}

export function MicIcon({ size = 16, color = "#1b2028" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
export function CameraIcon({ size = 16, color = "#1b2028" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
