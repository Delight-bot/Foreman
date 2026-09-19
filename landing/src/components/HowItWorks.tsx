import { useState, type ReactNode } from "react";
import { CircleCheck, CircleAlert, CircleX, Search } from "lucide-react";
import { Section, Heading } from "./ui";
import { Schematic } from "./mock/Schematic";

const stages = [
  {
    n: "01",
    name: "Ingest",
    text: "Manuals and technical documents are processed using OCR, layout detection, table extraction, and diagram analysis.",
    ml: "Computer vision, OCR, vision-language captions",
  },
  {
    n: "02",
    name: "Verify",
    text: "Extracted information is checked. Low-confidence content is flagged for review.",
    ml: "Page, element and semantic checks; review queue",
  },
  {
    n: "03",
    name: "Find",
    text: "Hybrid keyword and semantic search locates relevant procedures, diagrams, and technical information.",
    ml: "Keyword index, embeddings, reranking",
  },
  {
    n: "04",
    name: "Answer",
    text: "The AI generates a structured response using the retrieved evidence.",
    ml: "Language model with enforced citations",
  },
  {
    n: "05",
    name: "Prove",
    text: "Claims are checked against their sources. Unsupported claims are removed, and the response receives a confidence indicator.",
    ml: "Claim-to-source check, confidence score",
  },
];

export function HowItWorks() {
  const [i, setI] = useState(0);
  const s = stages[i];
  return (
    <Section id="how-it-works">
      <Heading
        title="How an answer is made"
        lede="Five stages between a manual in a drawer and a procedure on a phone. Select a stage to see what happens to the document."
      />

      {/* Stage rail */}
      <div className="relative">
        <div className="absolute left-0 right-0 top-[22px] hidden h-[2px] bg-ink md:block" aria-hidden="true" />
        <ol className="relative grid grid-cols-5 gap-2" aria-label="Stages">
          {stages.map((st, idx) => {
            const active = idx === i;
            return (
              <li key={st.n} className="flex flex-col items-center">
                <button
                  onClick={() => setI(idx)}
                  aria-current={active ? "step" : undefined}
                  className={`flex h-11 w-11 items-center justify-center rounded-full border-2 font-mono text-[13px] font-medium transition-colors ${
                    active
                      ? "border-orange bg-orange text-paper"
                      : idx < i
                        ? "border-ink bg-ink text-paper"
                        : "border-ink bg-paper text-ink hover:bg-ink hover:text-paper"
                  }`}
                >
                  {st.n}
                </button>
                <button onClick={() => setI(idx)} className={`mt-3 text-[13px] font-semibold md:text-[16px] ${active ? "text-orange" : "text-ink"}`}>
                  {st.name}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Stage detail */}
      <div className="mt-12 grid gap-10 lg:grid-cols-[380px_1fr]">
        <div key={s.n} className="fade-in">
          <div className="font-mono text-[13px] text-orange">{s.n}</div>
          <h3 className="mt-1 text-[30px] font-semibold">{s.name}</h3>
          <p className="mt-4 text-[17px] leading-relaxed text-ink-2">{s.text}</p>
          <div className="mt-6 border-t border-rule pt-4 text-[14px] text-ink-2">
            <span className="text-ink">Under the hood:</span> {s.ml}
          </div>
          <div className="mt-8 flex gap-2">
            <button onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0} className="rounded-md border border-ink px-4 py-2 text-[14px] font-semibold disabled:opacity-30">
              Previous
            </button>
            <button onClick={() => setI(Math.min(4, i + 1))} disabled={i === 4} className="rounded-md bg-ink px-4 py-2 text-[14px] font-semibold text-paper hover:bg-orange disabled:opacity-30">
              Next stage
            </button>
          </div>
        </div>
        <div key={"v" + s.n} className="fade-in min-h-[440px] rounded-lg border-[1.5px] border-ink bg-paper-2 p-6 md:p-8">
          {i === 0 && <IngestVisual />}
          {i === 1 && <VerifyVisual />}
          {i === 2 && <FindVisual />}
          {i === 3 && <AnswerVisual />}
          {i === 4 && <ProveVisual />}
        </div>
      </div>
    </Section>
  );
}

/* A small scanned page used by Ingest and Verify */
function PageSketch({
  labels,
  flags,
}: {
  labels?: boolean;
  flags?: { text: number; table: number; figure: number };
}) {
  const Box = ({
    region,
    className,
    children,
  }: {
    region: "text" | "table" | "figure";
    className: string;
    children?: ReactNode;
  }) => {
    const conf = flags?.[region];
    const low = conf !== undefined && conf < 0.75;
    return (
      <div className={`relative ${className} ${labels || flags ? (low ? "outline outline-2 outline-dashed outline-orange" : "outline outline-2 outline-dashed outline-ink/70") : ""} outline-offset-4 rounded-sm`}>
        {labels && (
          <span className="absolute -top-[18px] left-0 font-mono text-[10px] tracking-[0.08em] text-ink">{region.toUpperCase()}</span>
        )}
        {flags && (
          <span className={`absolute -top-[20px] right-0 flex items-center gap-1 font-mono text-[10px] tracking-[0.06em] ${low ? "text-orange" : "text-ink"}`}>
            {low ? <CircleAlert size={12} /> : <CircleCheck size={12} />} {conf?.toFixed(2)}
          </span>
        )}
        {children}
      </div>
    );
  };
  return (
    <div className="w-[300px] rotate-[-1.2deg] rounded-sm border-[1.5px] border-ink bg-paper p-5 shadow-[6px_6px_0_#1b2028]">
      <div className="font-mono text-[9px] tracking-[0.06em]">DRIVE MANUAL · §4.2 · SCANNED, 300 DPI</div>
      <Box region="text" className="mt-6 space-y-[5px]">
        {[100, 92, 96, 70].map((w, k) => (
          <div key={k} className="h-[6px] rounded-sm bg-ink/30" style={{ width: `${w}%` }} />
        ))}
      </Box>
      <Box region="table" className="mt-8">
        <div className="grid grid-cols-3 gap-[3px]">
          {Array.from({ length: 9 }).map((_, k) => (
            <div key={k} className={`h-[10px] rounded-[1px] ${k < 3 ? "bg-ink/60" : "bg-ink/20"}`} />
          ))}
        </div>
      </Box>
      <Box region="figure" className="mt-8">
        <div className="flex justify-center rounded border border-ink/60 px-2 py-1.5">
          <Schematic width={200} highlight={null} />
        </div>
      </Box>
    </div>
  );
}

function IngestVisual() {
  return (
    <div className="flex flex-col gap-8 md:flex-row md:items-start">
      <PageSketch labels />
      <div className="flex-1 text-[14px]">
        <div className="font-semibold">What the pipeline extracted from this page</div>
        <ul className="mt-3 divide-y divide-rule border-y border-rule">
          <Row k="Text" v="4 paragraphs, reading order kept, section 4.2.3 detected" />
          <Row k="Table" v="Table 4-3, 3 columns by 3 rows, units parsed" />
          <Row k="Figure" v="Fig. 12, tiled at high resolution and captioned: relays K1, K2, K3; pins 13 and 14" />
          <Row k="Position" v="Every element stored with page 47 and its bounding box" />
        </ul>
        <p className="mt-4 text-ink-2">
          Large drawings are split into overlapping tiles before the vision model reads them, so labels in the corners are not lost when a page is downsampled.
        </p>
      </div>
    </div>
  );
}

function VerifyVisual() {
  return (
    <div className="flex flex-col gap-8 md:flex-row md:items-start">
      <PageSketch flags={{ text: 0.97, table: 0.92, figure: 0.61 }} />
      <div className="flex-1 text-[14px]">
        <div className="font-semibold">Verification result for page 47</div>
        <ul className="mt-3 divide-y divide-rule border-y border-rule">
          <Row k="Text" v="Verified. Cross-reference to Fig. 12 resolves." ok />
          <Row k="Table" v="Verified. Row and column counts match the scan." ok />
          <Row k="Figure" v="Below threshold. Re-rendered at higher DPI and retried; still 0.61. Quarantined." warn />
        </ul>
        <div className="mt-4 rounded-md border-[1.5px] border-orange p-4">
          <div className="flex items-center gap-2 font-semibold"><CircleAlert size={16} className="text-orange" /> Sent to review</div>
          <p className="mt-1 text-ink-2">
            The figure is excluded from citations until the document owner confirms the extraction. The text and table on this page stay citable.
          </p>
        </div>
      </div>
    </div>
  );
}

function FindVisual() {
  const kw = [
    { hit: "E-42", where: "p. 47, §4.2.3", score: "exact" },
    { hit: "K3", where: "p. 47, Fig. 12", score: "exact" },
    { hit: "K3", where: "p. 51, rev. 2023 note", score: "exact" },
  ];
  const sem = [
    { hit: "open circuit on the control side", where: "p. 47, §4.2.3", score: "0.91" },
    { hit: "corroded terminal, contactor side", where: "p. 47, §4.2.3", score: "0.88" },
    { hit: "relay board terminal torque", where: "p. 47, Table 4-3", score: "0.74" },
  ];
  return (
    <div className="text-[14px]">
      <div className="flex items-center gap-2.5 rounded-full border-[1.5px] border-ink px-4 py-2.5">
        <Search size={16} />
        <span>relay K3 continuity fault E-42</span>
        <span className="ml-auto font-mono text-[11px] text-ink-2">asset CV-12 · 5 documents</span>
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <div className="font-semibold">Keyword matches</div>
          <p className="text-ink-2">Part numbers and fault codes must match exactly.</p>
          <ul className="mt-3 divide-y divide-rule border-y border-rule">
            {kw.map((r, k) => (
              <li key={k} className="flex items-baseline justify-between py-2">
                <span><span className="font-mono">{r.hit}</span> <span className="text-ink-2">{r.where}</span></span>
                <span className="font-mono text-[11px] text-ink-2">{r.score}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="font-semibold">Semantic matches</div>
          <p className="text-ink-2">Meaning, not spelling: the manual never says "continuity fault".</p>
          <ul className="mt-3 divide-y divide-rule border-y border-rule">
            {sem.map((r, k) => (
              <li key={k} className="flex items-baseline justify-between py-2">
                <span>{r.hit} <span className="text-ink-2">{r.where}</span></span>
                <span className="font-mono text-[11px] text-ink-2">{r.score}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-6 rounded-md bg-ink p-4 text-paper">
        <div className="font-semibold">After reranking, three chunks go to the model</div>
        <div className="mt-2 flex flex-wrap gap-2 font-mono text-[11px]">
          <span className="rounded bg-paper/15 px-2 py-1">p47-txt-4.2.3</span>
          <span className="rounded bg-paper/15 px-2 py-1">p47-fig-12</span>
          <span className="rounded bg-paper/15 px-2 py-1">p47-tbl-4-3</span>
          <span className="rounded border border-paper/30 px-2 py-1 text-paper/60">p51-note (held: unverified)</span>
        </div>
      </div>
    </div>
  );
}

function AnswerVisual() {
  const steps = [
    { t: "Lock out and tag out drive power before opening the cabinet.", c: "p47-txt-4.2.3", warn: true },
    { t: "Open panel B and inspect relay K3 for a corroded terminal on the contactor side.", c: "p47-txt-4.2.3" },
    { t: "Measure continuity across pins 13 and 14.", c: "p47-fig-12" },
    { t: "If open, replace the relay.", c: "p47-txt-4.2.3" },
    { t: "Torque terminals 13 and 14 to 0.6 N·m.", c: "p47-tbl-4-3" },
  ];
  return (
    <div className="text-[14px]">
      <p className="text-ink-2">
        The model sees the retrieved text, the table, and the figure crop itself. It must return every sentence paired with the chunk it came from; a sentence without one is dropped before it reaches the screen.
      </p>
      <ol className="mt-5 divide-y divide-rule border-y border-rule">
        {steps.map((s, k) => (
          <li key={k} className="grid grid-cols-[28px_1fr_auto] items-baseline gap-3 py-3">
            <span className="font-mono text-[12px] text-ink-2">{k === 0 ? "!" : k}</span>
            <span className={s.warn ? "font-semibold" : ""}>{s.t}</span>
            <span className="rounded border border-ink px-2 py-0.5 font-mono text-[11px]">{s.c}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-ink-2">Safety warnings from the source are pinned to the top of the procedure.</p>
    </div>
  );
}

function ProveVisual() {
  const claims = [
    { t: "Lock out drive power before opening the cabinet", src: "p. 47, §4.2.3", ok: true },
    { t: "Inspect relay K3 for a corroded terminal on the contactor side", src: "p. 47, §4.2.3", ok: true },
    { t: "Measure continuity across pins 13 and 14", src: "p. 47, Fig. 12", ok: true },
    { t: "Torque terminals 13 and 14 to 0.6 N·m", src: "p. 47, Table 4-3", ok: true },
    { t: "Reset the drive by cycling mains power", src: "no supporting passage", ok: false },
  ];
  return (
    <div className="text-[14px]">
      <p className="text-ink-2">A second pass asks, for every claim: does the cited passage actually say this?</p>
      <ul className="mt-5 divide-y divide-rule border-y border-rule">
        {claims.map((c, k) => (
          <li key={k} className={`flex items-start gap-3 py-3 ${c.ok ? "" : "text-ink-2 line-through decoration-orange"}`}>
            {c.ok ? <CircleCheck size={18} className="mt-0.5 shrink-0 text-orange" /> : <CircleX size={18} className="mt-0.5 shrink-0 text-orange" />}
            <span className="flex-1">{c.t}</span>
            <span className="font-mono text-[11px] text-ink-2">{c.src}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap items-center gap-4 rounded-md border-[1.5px] border-ink p-4">
        <span className="rounded bg-orange px-2.5 py-1 font-mono text-[11px] tracking-[0.06em] text-paper">VERIFIED SOURCE</span>
        <span>4 of 5 claims supported; the unsupported one was removed, not shown.</span>
      </div>
    </div>
  );
}

function Row({ k, v, ok, warn }: { k: string; v: string; ok?: boolean; warn?: boolean }) {
  return (
    <li className="grid grid-cols-[72px_1fr] gap-3 py-2.5">
      <span className="flex items-center gap-1.5 font-semibold">
        {ok && <CircleCheck size={14} className="text-ink" />}
        {warn && <CircleAlert size={14} className="text-orange" />}
        {k}
      </span>
      <span className="text-ink-2">{v}</span>
    </li>
  );
}
