import { Schematic } from "./Schematic";

export type Region = "figure" | "table" | "text" | null;

/**
 * A page of the drive manual as the evidence viewer shows it: header, procedure text,
 * a torque table, the wiring figure. `highlight` outlines the region an answer cites.
 */
export function ManualPage({
  highlight = "figure",
  page = 47,
  rev = "2019",
  revised = false,
  compact = false,
  className = "",
}: {
  highlight?: Region;
  page?: number;
  rev?: string;
  revised?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const hi = (r: Region) =>
    highlight === r ? "outline outline-[2.5px] outline-dashed outline-orange outline-offset-[6px] rounded-sm" : "";
  const label = (r: Region, text: string) =>
    highlight === r ? (
      <span className="absolute -top-[22px] left-0 rounded bg-orange px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-paper">
        {text}
      </span>
    ) : null;

  return (
    <div className={`relative ${className}`}>
      <div className="absolute -right-3 -top-3 z-10 rounded-md bg-orange px-3 py-1.5 font-mono text-[13px] font-medium text-paper">
        p. {page}
      </div>
      <div className="absolute left-[9px] top-[9px] h-full w-full rounded-md border-2 border-ink/70 bg-paper" aria-hidden="true" />
      <div className="absolute left-[18px] top-[18px] h-full w-full rounded-md border-2 border-ink/50 bg-paper" aria-hidden="true" />
      <article className={`relative rounded-md border-[2.5px] border-ink bg-paper-2 ${compact ? "p-5" : "p-7"} text-ink`}>
        <div className="flex items-baseline justify-between border-b-[1.5px] border-ink pb-2 font-mono text-[11px] tracking-[0.06em]">
          <span>DRIVE MANUAL · §4.2 RELAY BOARD</span>
          <span>REV. {rev}</span>
        </div>

        <div className={`relative mt-5 ${hi("text")}`}>
          {label("text", "CITED PASSAGE")}
          <h4 className="text-[13px] font-semibold">4.2.3 Continuity fault E-42</h4>
          <p className="mt-1.5 text-[11.5px] leading-[1.5] text-ink-2">
            Fault E-42 indicates an open circuit on the control side of the relay board. With drive power locked out,
            open panel B and inspect relay {revised ? "K4" : "K3"} for a corroded terminal on the contactor side. Measure
            continuity across pins 13 and 14 (see Fig. 12). If open, replace the relay and torque terminals to the values
            in Table 4-3.
          </p>
        </div>

        <div className={`relative mt-6 ${hi("table")}`}>
          {label("table", "CITED TABLE")}
          <div className="font-mono text-[10.5px] tracking-[0.06em]">TABLE 4-3 · TERMINAL TORQUE</div>
          <table className="mt-1.5 w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b-[1.5px] border-ink text-left">
                <th className="py-1 pr-2 font-semibold">Terminal</th>
                <th className="py-1 pr-2 font-semibold">Wire</th>
                <th className="py-1 font-semibold">Torque</th>
              </tr>
            </thead>
            <tbody className="text-ink-2">
              <tr className="border-b border-rule"><td className="py-1 pr-2">13, 14</td><td className="py-1 pr-2">1.5 mm²</td><td className="py-1">0.6 N·m</td></tr>
              <tr className="border-b border-rule"><td className="py-1 pr-2">A1, A2</td><td className="py-1 pr-2">1.5 mm²</td><td className="py-1">0.6 N·m</td></tr>
              <tr><td className="py-1 pr-2">L1, T1</td><td className="py-1 pr-2">4.0 mm²</td><td className="py-1">1.2 N·m</td></tr>
            </tbody>
          </table>
        </div>

        <div className={`relative mt-6 ${hi("figure")}`}>
          {label("figure", "CITED FIGURE")}
          <div className="rounded border-[1.5px] border-ink">
            <div className="flex items-center justify-between border-b-[1.5px] border-ink px-3 py-1.5 font-mono text-[10.5px] tracking-[0.06em]">
              <span>FIG. 12 · CABINET B</span>
              <span className="text-orange">{revised ? "K4" : "K3"} SHOWN</span>
            </div>
            <div className="flex justify-center px-3 py-2">
              <Schematic highlight={revised ? "K4" : "K3"} revised={revised} width={compact ? 240 : 276} />
            </div>
          </div>
          <p className="mt-1.5 text-[10.5px] text-ink-2">Fig. 12: continuity across pins 13 and 14, relay board, cabinet B.</p>
        </div>
      </article>
    </div>
  );
}
