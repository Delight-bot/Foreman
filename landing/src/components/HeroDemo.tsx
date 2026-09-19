import { useState, useEffect, useRef } from "react";
import { QrCode, TriangleAlert, CircleCheck, ArrowLeft, UserRound } from "lucide-react";
import { PhoneFrame, AskBar, MicIcon, CameraIcon } from "./mock/PhoneFrame";
import { Schematic } from "./mock/Schematic";
import { ManualPage } from "./mock/ManualPage";

type Step = 0 | 1 | 2 | 3;

const steps = [
  { title: "Identify the machine", detail: "Scan the asset tag. The manuals for that machine are already selected." },
  { title: "Describe the problem", detail: "Say it or photograph it. No typing with gloves on." },
  { title: "Receive a procedure", detail: "Warning first, then numbered steps, each with its source." },
  { title: "Inspect the evidence", detail: "Open the cited page. The region the answer came from is marked." },
];

export function HeroDemo() {
  const [step, setStep] = useState<Step>(0);
  const next = () => setStep((s) => (Math.min(s + 1, 3) as Step));

  return (
    <div className="flex w-[320px] flex-col items-stretch gap-5">
      <div className="border-l-[3px] border-orange pl-4" aria-live="polite">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[12px] text-ink-2">Step {step + 1} of 4</span>
          <span className="flex gap-1.5" role="tablist" aria-label="Workflow steps">
            {steps.map((s, i) => (
              <button
                key={s.title}
                role="tab"
                aria-selected={i === step}
                aria-label={`${i + 1}. ${s.title}`}
                onClick={() => setStep(i as Step)}
                className={`h-2.5 w-7 rounded-sm transition-colors ${i === step ? "bg-orange" : i < step ? "bg-ink" : "bg-ink/20 hover:bg-ink/50"}`}
              />
            ))}
          </span>
        </div>
        <div className="mt-1.5 text-[18px] font-semibold leading-tight">{steps[step].title}</div>
        <div className="mt-1 text-[14px] leading-snug text-ink-2">{steps[step].detail}</div>
      </div>

      <PhoneFrame
        chip={["", "", "Fault E-42", "Page 47"][step] || undefined}
        chipTone={step === 3 ? "ink" : "orange"}
        clock={["9:41", "9:41", "9:42", "9:42"][step]}
      >
        <div key={step} className="fade-in flex min-h-0 flex-1 flex-col">
          {step === 0 && <IdentifyScreen onNext={next} />}
          {step === 1 && <DescribeScreen onNext={next} />}
          {step === 2 && <ProcedureScreen onNext={next} />}
          {step === 3 && <EvidenceScreen onBack={() => setStep(2)} />}
        </div>
      </PhoneFrame>

      <div className="flex justify-between text-[14px]">
        <button onClick={() => setStep(Math.max(0, step - 1) as Step)} disabled={step === 0} className="font-semibold hover:text-orange disabled:opacity-30">Back</button>
        <button onClick={next} disabled={step === 3} className="font-semibold hover:text-orange disabled:opacity-30">Continue</button>
      </div>
    </div>
  );
}

/* Screen 1: viewfinder over an asset tag */
function IdentifyScreen({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-1 flex-col px-5 pt-4">
      <div className="relative h-[300px] overflow-hidden rounded-xl bg-ink">
        {/* cabinet door and tag */}
        <div className="absolute inset-x-8 top-6 h-[260px] rounded border-2 border-paper/20" />
        <div className="absolute left-1/2 top-[110px] w-[150px] -translate-x-1/2 rounded bg-paper p-2 text-ink">
          <div className="flex items-center gap-2">
            <QrCode size={44} strokeWidth={1.6} />
            <div className="font-mono text-[9px] leading-tight">
              <div className="font-medium">ASSET CV-12</div>
              <div className="mt-1 text-ink-2">CONVEYOR</div>
              <div className="text-ink-2">LINE 3 · CAB. B</div>
            </div>
          </div>
        </div>
        {/* scan brackets */}
        {["top-4 left-4 border-t-2 border-l-2", "top-4 right-4 border-t-2 border-r-2", "bottom-4 left-4 border-b-2 border-l-2", "bottom-4 right-4 border-b-2 border-r-2"].map((c) => (
          <span key={c} className={`absolute h-7 w-7 border-orange ${c}`} />
        ))}
        <div className="scan-line absolute inset-x-6 top-16 h-[2px] bg-orange/80" />
      </div>
      <div className="mt-4 flex items-center gap-2.5 rounded-lg border-[1.5px] border-ink px-3.5 py-2.5 text-[13px]">
        <CircleCheck size={18} className="text-orange" />
        <span>
          <b className="font-semibold">Conveyor CV-12</b> recognized. 5 documents on this device.
        </span>
      </div>
      <div className="flex-1" />
      <button onClick={onNext} className="rounded-xl bg-ink py-3.5 text-[14px] font-semibold text-paper hover:bg-orange">
        Open asset
      </button>
      <AskBar />
    </div>
  );
}

/* Screen 2: voice or photo fault report */
function DescribeScreen({ onNext }: { onNext: () => void }) {
  const bars = [12, 22, 34, 18, 30, 40, 24, 14, 28, 36, 20, 10, 26, 32, 16];
  return (
    <div className="flex flex-1 flex-col px-5 pt-4">
      <div className="rounded-xl border-[1.5px] border-ink p-4">
        <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.08em]">
          <MicIcon /> LISTENING
        </div>
        <div className="mt-3 flex h-12 items-center justify-center gap-[3px]" aria-hidden="true">
          {bars.map((h, i) => (
            <span key={i} className="mic-bar block w-[4px] rounded bg-orange" style={{ height: h, animationDelay: `${i * 70}ms` }} />
          ))}
        </div>
        <p className="mt-3 text-[15px] leading-snug">"Relay K3 showing continuity fault E-42."</p>
      </div>
      <div className="mt-3 flex items-center gap-3 rounded-xl border-[1.5px] border-dashed border-ink px-4 py-3">
        <CameraIcon size={20} />
        <span className="text-[13px]">Add a photo of the panel <span className="text-ink-2">(optional)</span></span>
      </div>
      <p className="mt-3 text-[12px] leading-snug text-ink-2">
        Your words and photo are used to find the right page. They are not added to the manuals.
      </p>
      <div className="flex-1" />
      <button onClick={onNext} className="rounded-xl bg-ink py-3.5 text-[14px] font-semibold text-paper hover:bg-orange">
        Get procedure
      </button>
      <AskBar />
    </div>
  );
}

/* Screen 3: the procedure with warning, steps, citation, figure */
function ProcedureScreen({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-1 flex-col px-5 pt-3.5">
      <div className="flex items-start gap-2.5 rounded-xl bg-orange px-3.5 py-3 text-[13px] leading-snug text-paper">
        <TriangleAlert size={18} className="mt-0.5 shrink-0" />
        <span><b className="font-semibold">Lock out and tag out</b> drive power before opening the cabinet.</span>
      </div>
      <div className="mt-3 flex items-center justify-between font-mono text-[11px] tracking-[0.08em]">
        <span>STEP 2 OF 5</span>
        <span className="flex gap-1.5" aria-label="Progress: 2 of 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <i key={n} className={`block h-[5px] w-[22px] rounded ${n <= 2 ? "bg-orange" : "bg-ink/20"}`} />
          ))}
        </span>
      </div>
      <p className="mt-2.5 text-[15.5px] leading-[1.4]">
        Open panel B and inspect relay <b className="font-semibold">K3</b> for a corroded terminal on the contactor side.
        Measure continuity across pins 13 and 14.
      </p>
      <button
        onClick={onNext}
        className="mt-3 flex items-center gap-2.5 rounded-xl border-[1.5px] border-ink px-3 py-2.5 text-left text-[12.5px] leading-snug hover:border-orange"
      >
        <CircleCheck size={18} className="shrink-0 text-orange" />
        <span>
          Drive manual §4.2, p. 47, Fig. 12<br />
          <span className="font-semibold text-orange">Verified source</span> <span className="text-ink-2">· tap to view page</span>
        </span>
      </button>
      <div className="mt-3 rounded-xl border-[1.5px] border-ink">
        <div className="flex justify-between border-b-[1.5px] border-ink px-3 py-1.5 font-mono text-[10.5px] tracking-[0.08em]">
          <span>FIG. 12 · CABINET B</span>
          <span className="text-orange">K3 SHOWN</span>
        </div>
        <div className="flex justify-center px-2 py-1.5">
          <Schematic width={250} />
        </div>
      </div>
      <div className="flex-1" />
      <div className="flex gap-2.5">
        <button className="flex-1 rounded-xl bg-ink py-3 text-[14px] font-semibold text-paper hover:bg-orange">Next step</button>
        <a href="#correction" className="flex flex-1 items-center justify-center rounded-xl border-[1.5px] border-ink py-3 text-[14px] font-semibold hover:border-orange">
          Not what I see
        </a>
      </div>
      <AskBar />
    </div>
  );
}

/* Screen 4: the cited page with the region marked */
function EvidenceScreen({ onBack }: { onBack: () => void }) {
  const pane = useRef<HTMLDivElement>(null);
  // Open the page already scrolled to the cited region, as the real viewer would.
  useEffect(() => {
    const el = pane.current;
    if (el) el.scrollTop = el.scrollHeight - el.clientHeight;
  }, []);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-5 pt-3 pb-2">
        <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] font-semibold hover:text-orange">
          <ArrowLeft size={16} /> Procedure
        </button>
        <span className="font-mono text-[11px] tracking-[0.08em]">CITED REGION</span>
      </div>
      <div ref={pane} className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-3">
        <div className="origin-top-left scale-[0.86]" style={{ width: "116%" }}>
          <ManualPage highlight="figure" compact />
        </div>
      </div>
      <div className="mx-5 flex items-center gap-2 rounded-lg border-[1.5px] border-ink px-3 py-2 text-[12px]">
        <UserRound size={16} className="shrink-0" />
        <span>Owner: reliability engineering. Uploaded rev. 2019, verified.</span>
      </div>
    </div>
  );
}
