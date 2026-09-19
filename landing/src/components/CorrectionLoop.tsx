import { useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Flag, PhoneCall, UserRound, TriangleAlert } from "lucide-react";
import { Section, Heading } from "./ui";
import { PhoneFrame, AskBar, MicIcon, CameraIcon } from "./mock/PhoneFrame";
import { Schematic } from "./mock/Schematic";

type Stage = 0 | 1 | 2 | 3 | 4 | 5;

const stages: { title: string; detail: string; branch?: "found" | "none" }[] = [
  { title: "The technician identifies a mismatch", detail: "The panel in front of them does not look like the step. They tap Not what I see." },
  { title: "They submit a photo or describe the difference", detail: "The procedure pauses. Nothing is guessed while they wait." },
  { title: "Foreman searches for a verified alternative", detail: "The photo is used to re-search the verified library. It is not added to the manuals." },
  { title: "A match is found: the procedure is revised", detail: "The step is rewritten with a new citation to the page that matches.", branch: "found" },
  { title: "No match: the issue is escalated", detail: "The photo, the original citation and what was tried go to the document owner.", branch: "none" },
  { title: "The owner's fix note becomes a source", detail: "The next technician who hits this fault gets the verified fix, cited to the owner." },
];

export function CorrectionLoop() {
  const [stage, setStage] = useState<Stage>(0);
  const chip = ["Fault E-42", "Step 2 paused", "Re-checking", "Step 2 revised", "Escalated", "Fix note added"][stage];
  const tone = stage === 1 || stage === 2 || stage === 4 ? "ink" : "orange";

  return (
    <Section id="correction" dots className="border-y border-rule">
      <Heading
        title="When the procedure does not match the machine."
        lede="Manuals lag behind the plant. Revisions move a relay, a vendor renumbers a terminal, a previous fix changed the wiring. Foreman is built for the moment the page and the panel disagree."
      />

      <div className="grid gap-12 lg:grid-cols-[1fr_auto] lg:gap-16">
        <ol className="order-2 lg:order-1" aria-label="Correction loop steps">
          {stages.map((s, i) => {
            const active = i === stage;
            const branchLabel = s.branch === "found" ? "If a match is found" : s.branch === "none" ? "If no match is found" : null;
            return (
              <li key={s.title}>
                <button
                  onClick={() => setStage(i as Stage)}
                  aria-current={active ? "step" : undefined}
                  className={`flex w-full gap-4 border-l-[3px] py-3.5 pl-5 text-left transition-colors ${
                    active ? "border-orange" : "border-rule hover:border-ink"
                  } ${s.branch ? "ml-6" : ""}`}
                >
                  <span className={`font-mono text-[13px] ${active ? "text-orange" : "text-ink-2"}`}>
                    {s.branch ? (s.branch === "found" ? "4a" : "4b") : i < 3 ? i + 1 : 5}
                  </span>
                  <span>
                    {branchLabel && <span className="block text-[12px] text-ink-2">{branchLabel}</span>}
                    <span className={`block text-[17px] font-semibold ${active ? "text-ink" : "text-ink-2"}`}>{s.title}</span>
                    {active && <span className="mt-1 block text-[14px] leading-snug text-ink-2">{s.detail}</span>}
                  </span>
                </button>
              </li>
            );
          })}
          <li className="mt-8 border-l-[3px] border-ink py-4 pl-5">
            <div className="flex items-center gap-2 text-[17px] font-semibold"><TriangleAlert size={18} className="text-orange" /> The rule underneath</div>
            <p className="mt-1.5 text-[15px] leading-snug text-ink-2">
              When the system cannot verify a step, it does not guess. It shows what it can confirm, says what it cannot, and hands the technician to a person with the full context.
            </p>
          </li>
        </ol>

        <div className="order-1 flex justify-center lg:order-2">
          <PhoneFrame chip={chip} chipTone={tone} clock={["9:42", "9:43", "9:43", "9:44", "9:44", "Tue 14:10"][stage]}>
            <div key={stage} className="fade-in flex min-h-0 flex-1 flex-col">
              {stage === 0 && <MismatchScreen />}
              {stage === 1 && <ReportScreen />}
              {stage === 2 && <SearchingScreen />}
              {stage === 3 && <RevisedScreen />}
              {stage === 4 && <EscalatedScreen />}
              {stage === 5 && <FixNoteScreen />}
            </div>
          </PhoneFrame>
        </div>
      </div>
    </Section>
  );
}

function Warn({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <div className={`flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] leading-snug text-paper ${dark ? "bg-ink" : "bg-orange"}`}>
      {children}
    </div>
  );
}

function MismatchScreen() {
  return (
    <div className="flex flex-1 flex-col px-5 pt-3.5">
      <Warn><TriangleAlert size={18} className="mt-0.5 shrink-0" /><span><b className="font-semibold">Lock out and tag out</b> drive power before opening the cabinet.</span></Warn>
      <div className="mt-3 font-mono text-[11px] tracking-[0.08em]">STEP 2 OF 5</div>
      <p className="mt-2 text-[15px] leading-[1.4]">Open panel B and inspect relay <b className="font-semibold">K3</b> for a corroded terminal on the contactor side.</p>
      <div className="mt-3 rounded-xl border-[1.5px] border-ink">
        <div className="flex justify-between border-b-[1.5px] border-ink px-3 py-1.5 font-mono text-[10.5px] tracking-[0.08em]"><span>FIG. 12 · CABINET B</span><span className="text-orange">K3 SHOWN</span></div>
        <div className="flex justify-center px-2 py-1.5"><Schematic width={250} /></div>
      </div>
      <p className="mt-3 text-[12.5px] text-ink-2">On the real panel there is no relay where K3 should be.</p>
      <div className="flex-1" />
      <div className="flex gap-2.5">
        <button className="flex-1 rounded-xl bg-ink py-3 text-[14px] font-semibold text-paper">Next step</button>
        <button className="flex-1 rounded-xl border-[2.5px] border-orange py-3 text-[14px] font-semibold text-orange">Not what I see</button>
      </div>
      <AskBar />
    </div>
  );
}

function ReportScreen() {
  return (
    <div className="flex flex-1 flex-col px-5 pt-3.5">
      <Warn><CircleAlert size={18} className="mt-0.5 shrink-0" /><span><b className="font-semibold">Not what you see?</b> Tell us what is different and we will re-check the manuals.</span></Warn>
      <div className="mt-3 flex h-[74px] items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-ink font-mono text-[12px] tracking-[0.08em]">
        <CameraIcon size={18} /> TAKE A PHOTO
      </div>
      <div className="mt-3 flex items-center gap-3 rounded-xl border-[1.5px] border-ink px-3.5 py-3 text-[14px] font-medium"><MicIcon size={20} /> Say what you see</div>
      <div className="mt-3 flex items-center gap-3 rounded-xl border-[1.5px] border-ink px-3.5 py-3 text-[14px] font-medium">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1b2028" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></svg>
        Enter a different part number
      </div>
      <p className="mt-3 text-[12px] leading-snug text-ink-2">The procedure stays paused until you confirm. Your photo is used to re-search; it is not added to the manuals.</p>
      <div className="flex-1" />
      <button className="rounded-xl bg-ink py-3.5 text-[14px] font-semibold text-paper">Send and re-check</button>
      <AskBar />
    </div>
  );
}

function SearchingScreen() {
  const rows = [
    { t: "Photo received: cabinet B, relay board", done: true },
    { t: "Comparing to Fig. 12, rev. 2019", done: true },
    { t: "Checking rev. 2023 drawings for this asset", done: true },
    { t: "Verified match on p. 51, Fig. 14", done: false, hi: true },
  ];
  return (
    <div className="flex flex-1 flex-col px-5 pt-3.5">
      <div className="rounded-xl border-[1.5px] border-ink p-3">
        <div className="font-mono text-[11px] tracking-[0.08em]">YOUR PHOTO</div>
        <div className="mt-2 flex h-[110px] items-center justify-center rounded-lg bg-ink">
          <div className="rounded border border-paper/40 px-3 py-2 font-mono text-[10px] text-paper/80">K1 · K2 · [ ] · K4</div>
        </div>
      </div>
      <ul className="mt-4 space-y-2.5 text-[13.5px]">
        {rows.map((r, k) => (
          <li key={k} className="flex items-start gap-2.5">
            {r.hi ? <CircleCheck size={18} className="mt-0.5 shrink-0 text-orange" /> : <CircleCheck size={18} className="mt-0.5 shrink-0 text-ink" />}
            <span className={r.hi ? "font-semibold" : ""}>{r.t}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] leading-snug text-ink-2">Only verified pages are searched. A page still in the review queue cannot be matched.</p>
      <div className="flex-1" />
      <AskBar />
    </div>
  );
}

function RevisedScreen() {
  return (
    <div className="flex flex-1 flex-col px-5 pt-3.5">
      <Warn dark><CameraIcon size={18} color="#f3f1ec" /><span><b className="font-semibold">Matched your photo</b> to the 2023 revision of the drawing.</span></Warn>
      <div className="mt-3 font-mono text-[11px] tracking-[0.08em]">STEP 2 OF 5</div>
      <p className="mt-2 text-[15px] leading-[1.4]">Your panel uses relay <b className="font-semibold">K4</b>, not K3; the 2023 revision moved it to the right of the contactor. Inspect K4 for a corroded terminal.</p>
      <div className="mt-3 flex items-center gap-2.5 rounded-xl border-[1.5px] border-ink px-3 py-2.5 text-[12.5px] leading-snug">
        <CircleCheck size={18} className="shrink-0 text-orange" />
        <span>Manual rev. 2023, p. 51, Fig. 14<br /><span className="font-semibold text-orange">Verified source</span> <span className="text-ink-2">· tap to view page</span></span>
      </div>
      <div className="mt-3 rounded-xl border-[1.5px] border-ink">
        <div className="flex justify-between border-b-[1.5px] border-ink px-3 py-1.5 font-mono text-[10.5px] tracking-[0.08em]"><span>FIG. 14 · REV. 2023</span><span className="text-orange">K4 SHOWN</span></div>
        <div className="flex justify-center px-2 py-1.5"><Schematic width={250} revised highlight="K4" /></div>
      </div>
      <div className="flex-1" />
      <div className="flex gap-2.5">
        <button className="flex-1 rounded-xl bg-ink py-3 text-[14px] font-semibold text-paper">Continue</button>
        <button className="flex-1 rounded-xl border-[1.5px] border-ink py-3 text-[14px] font-semibold">Call owner</button>
      </div>
      <AskBar />
    </div>
  );
}

function EscalatedScreen() {
  return (
    <div className="flex flex-1 flex-col px-5 pt-3.5">
      <Warn dark><Flag size={18} className="mt-0.5 shrink-0" /><span><b className="font-semibold">No verified match</b> for what you photographed. Nothing has been guessed.</span></Warn>
      <div className="mt-3 rounded-xl border-[1.5px] border-ink p-3.5 text-[13px]">
        <div className="flex items-center gap-2 font-semibold"><UserRound size={16} /> Sent to the document owner</div>
        <ul className="mt-2 space-y-1 text-ink-2">
          <li>Your photo and note</li>
          <li>The step you were on and its citation, p. 47</li>
          <li>What was tried: continuity across 13 and 14</li>
        </ul>
      </div>
      <p className="mt-3 text-[13px] leading-snug">Closest verified page, for reference only: p. 47, Fig. 12. Check the panel against it before acting.</p>
      <div className="flex-1" />
      <div className="flex gap-2.5">
        <button className="flex flex-1 items-center justify-center gap-2 rounded-xl border-[2.5px] border-orange py-3 text-[14px] font-semibold text-orange"><PhoneCall size={16} /> Call owner</button>
        <button className="flex-1 rounded-xl border-[1.5px] border-ink py-3 text-[14px] font-semibold">Wait for reply</button>
      </div>
      <AskBar />
    </div>
  );
}

function FixNoteScreen() {
  return (
    <div className="flex flex-1 flex-col px-5 pt-3.5">
      <div className="font-mono text-[11px] tracking-[0.08em]">NEXT TECHNICIAN · SAME FAULT</div>
      <Warn><TriangleAlert size={18} className="mt-0.5 shrink-0" /><span><b className="font-semibold">Lock out and tag out</b> drive power before opening the cabinet.</span></Warn>
      <p className="mt-3 text-[15px] leading-[1.4]">Inspect relay <b className="font-semibold">K4</b>, right of the contactor. On CV-12 the terminal corrodes at pin 14; clean and re-torque before replacing.</p>
      <div className="mt-3 flex items-center gap-2.5 rounded-xl border-[1.5px] border-ink px-3 py-2.5 text-[12.5px] leading-snug">
        <CircleCheck size={18} className="shrink-0 text-orange" />
        <span>Manual rev. 2023, p. 51<br /><span className="font-semibold text-orange">Verified source</span></span>
      </div>
      <div className="mt-2.5 flex items-center gap-2.5 rounded-xl border-[1.5px] border-orange px-3 py-2.5 text-[12.5px] leading-snug">
        <UserRound size={18} className="shrink-0 text-orange" />
        <span>Fix note, document owner, reliability engineering<br /><span className="font-semibold text-orange">Verified by owner</span> <span className="text-ink-2">· added after escalation</span></span>
      </div>
      <div className="flex-1" />
      <button className="rounded-xl bg-ink py-3.5 text-[14px] font-semibold text-paper">Next step</button>
      <AskBar />
    </div>
  );
}
