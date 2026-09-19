import { useState } from "react";
import { CircleCheck, CircleAlert, CircleX, Flag } from "lucide-react";
import { Section, Heading } from "./ui";
import { ManualPage, type Region } from "./mock/ManualPage";

const chips: { region: Region; label: string; claim: string }[] = [
  { region: "text", label: "§4.2.3, p. 47", claim: "Inspect relay K3 for a corroded terminal on the contactor side." },
  { region: "figure", label: "Fig. 12, p. 47", claim: "Measure continuity across pins 13 and 14." },
  { region: "table", label: "Table 4-3, p. 47", claim: "Torque terminals 13 and 14 to 0.6 N·m." },
];

const receipt = [
  { k: "Document and version", v: "Drive manual, rev. 2019" },
  { k: "Page number", v: "47" },
  { k: "Relevant region", v: "Bounding box of the cited passage, table, or figure" },
  { k: "Source owner", v: "Reliability engineering; one tap to call" },
  { k: "Confidence", v: "Verified source, unverified page, or not found" },
  { k: "Answer history", v: "Query, retrieved chunks, model version, final text" },
];

const outcomes = [
  { icon: CircleCheck, state: "Verified source", result: "Procedure with evidence chips on every step" },
  { icon: CircleAlert, state: "Unverified page", result: "The answer is shown with a warning: check the original before acting" },
  { icon: CircleX, state: "Information not found", result: "No invented procedure. The closest page is shown and the gap is named" },
  { icon: Flag, state: "Technician flags an issue", result: "Escalation to the document owner with the photo, citation, and what was tried" },
];

export function Trust() {
  const [active, setActive] = useState(1);
  const chip = chips[active];
  return (
    <Section id="trust">
      <Heading
        title="Every answer has a receipt."
        lede="A procedure is only as good as the page behind it. Select a step below to see the page and region it was taken from."
      />

      <div className="grid gap-10 lg:grid-cols-[1fr_440px] lg:gap-16">
        <div>
          <ol className="divide-y divide-rule border-y border-rule" aria-label="Cited steps">
            {chips.map((c, i) => {
              const on = i === active;
              return (
                <li key={c.region}>
                  <button
                    onClick={() => setActive(i)}
                    aria-pressed={on}
                    className="flex w-full items-start gap-4 py-4 text-left"
                  >
                    <span className="mt-1 font-mono text-[13px] text-ink-2">{i + 2}</span>
                    <span className="flex-1 text-[17px] leading-snug">{c.claim}</span>
                    <span
                      className={`flex shrink-0 items-center gap-1.5 rounded-md border-[1.5px] px-2.5 py-1.5 text-[13px] font-semibold transition-colors ${
                        on ? "border-orange bg-orange text-paper" : "border-ink text-ink hover:border-orange hover:text-orange"
                      }`}
                    >
                      <CircleCheck size={14} /> {c.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="mt-10">
            <h3 className="text-[22px] font-semibold">What travels with each claim</h3>
            <dl className="mt-4 divide-y divide-rule border-y border-rule text-[15px]">
              {receipt.map((r) => (
                <div key={r.k} className="grid grid-cols-[200px_1fr] gap-4 py-3">
                  <dt className="font-semibold">{r.k}</dt>
                  <dd className="text-ink-2">{r.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="lg:pt-2">
          <div key={chip.region} className="fade-in">
            <ManualPage highlight={chip.region} />
          </div>
          <p className="mt-6 text-[14px] text-ink-2">
            The viewer opens the original page, not a transcription. The dashed outline is the stored bounding box for the cited region.
          </p>
        </div>
      </div>

      <div className="mt-20">
        <h3 className="text-[22px] font-semibold">When information cannot be verified</h3>
        <ul className="mt-5 grid gap-px overflow-hidden rounded-lg border-[1.5px] border-ink bg-ink md:grid-cols-2">
          {outcomes.map((o) => (
            <li key={o.state} className="bg-paper-2 p-6">
              <div className="flex items-center gap-2.5 text-[17px] font-semibold">
                <o.icon size={20} className="text-orange" /> {o.state}
              </div>
              <p className="mt-2 text-[15px] leading-snug text-ink-2">{o.result}</p>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
