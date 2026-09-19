import { Button, LinkButton } from "./ui";
import { HeroDemo } from "./HeroDemo";

export function Hero({ onDemo }: { onDemo: () => void }) {
  return (
    <section id="top" className="dots border-b border-rule">
      <div className="mx-auto grid w-full max-w-[1180px] gap-14 px-6 pb-20 pt-16 md:pt-24 lg:grid-cols-[1fr_320px] lg:gap-16">
        <div className="max-w-[720px]">
          <h1 className="text-[42px] leading-[1.06] font-semibold md:text-[64px]">
            The answer is on page 47. Your search bar can't find it.
          </h1>
          <hr className="mt-7 w-28 border-0 border-t-[3px] border-orange" />
          <p className="mt-7 text-[21px] leading-snug md:text-[24px]">
            Scan the machine. Describe the problem. Get the procedure with the page it came from.
          </p>
          <p className="mt-5 max-w-[560px] text-[17px] leading-relaxed text-ink-2">
            Foreman helps maintenance technicians troubleshoot equipment using manuals, scanned pages, technical
            drawings, and visual evidence, with every answer tied to its source.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <LinkButton href="#how-it-works">See how it works</LinkButton>
            <Button variant="secondary" onClick={onDemo}>Request a demo</Button>
          </div>
          <p className="mt-10 text-[14px] text-ink-2">
            Try the walkthrough: it is the same screen a technician would hold in front of the machine.
          </p>
        </div>
        <div id="product" className="flex justify-center scroll-mt-24 lg:justify-end">
          <HeroDemo />
        </div>
      </div>
    </section>
  );
}
