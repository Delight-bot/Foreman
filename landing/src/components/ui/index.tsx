import type { ReactNode, ButtonHTMLAttributes, AnchorHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "quiet";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md px-5 py-3 text-[15px] font-semibold transition-colors focus-visible:outline-orange";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-orange",
  secondary: "border border-ink text-ink hover:border-orange hover:text-orange",
  quiet: "text-ink hover:text-orange px-2",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function LinkButton({
  variant = "primary",
  className = "",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return <a className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Section({
  id,
  children,
  className = "",
  dots = false,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  dots?: boolean;
}) {
  return (
    <section id={id} className={`${dots ? "dots" : ""} scroll-mt-20 ${className}`}>
      <div className="mx-auto w-full max-w-[1180px] px-6 py-20 md:py-28">{children}</div>
    </section>
  );
}

export function Heading({
  title,
  lede,
  rule = true,
}: {
  title: string;
  lede?: string;
  rule?: boolean;
}) {
  return (
    <header className="mb-12 max-w-[820px]">
      <h2 className="text-[34px] leading-[1.12] font-semibold md:text-[46px]">{title}</h2>
      {rule && <hr className="mt-6 w-24 border-0 border-t-[3px] border-orange" />}
      {lede && <p className="mt-5 text-lg leading-relaxed text-ink-2 md:text-xl">{lede}</p>}
    </header>
  );
}

/** Small mono label used inside product mockups where a real device would show one. */
export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[11px] tracking-[0.08em] ${className}`}>{children}</span>;
}

export function Tag({
  children,
  tone = "orange",
}: {
  children: ReactNode;
  tone?: "orange" | "ink";
}) {
  const t = tone === "orange" ? "bg-orange text-paper" : "bg-ink text-paper";
  return <span className={`rounded px-2 py-1 font-mono text-[11px] tracking-[0.08em] ${t}`}>{children}</span>;
}
