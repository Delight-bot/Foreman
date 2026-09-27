"use client";

import { GitBranch, Hash, Layers, Repeat } from "lucide-react";
import type { Answer, Citation, PageStatus } from "@/lib/api";
import { chipText } from "./Evidence";
import { Card, Mono, StatusPill } from "./ui";

/** Engineer mode's receipt: why these pages, and how much they can be trusted.
 *
 *  Everything here is retrieval metadata Foreman already records on every answer - the codes
 *  that matched exactly, the graph links that brought a chunk in, the reranker's score, the
 *  page's verification status. None of it is the model's account of its own reasoning. */
export function WhyThisAnswer({ answer, onCite }: { answer: Answer; onCite: (c: Citation) => void }) {
  const retrieved = answer.retrieved ?? [];
  const codes = unique(retrieved.flatMap((r) => r.codes ?? []));
  const graph = unique(retrieved.flatMap((r) => r.graph ?? []));
  const carried = retrieved.filter((r) => r.carried);
  const used = new Set(
    [...answer.warnings, ...answer.steps].flatMap((c) => c.chunk_ids),
  );

  // Page status comes from the retrieval log, and from the citation when the chunk was used.
  const quality = new Map<PageStatus, number>();
  for (const r of retrieved) {
    const status = (answer.citations[String(r.chunk_id)]?.status ?? r.status) as PageStatus | undefined;
    if (status) quality.set(status, (quality.get(status) ?? 0) + 1);
  }

  if (retrieved.length === 0) return null;

  return (
    <Card className="mt-4 p-4">
      <h3 className="text-[15px] font-semibold">Why this answer?</h3>
      <p className="mt-0.5 text-[13px] text-ink-2">
        What was retrieved, why it was retrieved, and how far it can be trusted. Nothing here is the model
        explaining itself.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Facts icon={<Hash size={14} />} label="Matched identifiers" items={codes} empty="No exact code matched." />
        <Facts icon={<GitBranch size={14} />} label="Graph links" items={graph} empty="No graph link was used." />
      </div>

      <Section label="Evidence quality">
        {quality.size ? (
          <div className="flex flex-wrap items-center gap-2">
            {[...quality].map(([status, n]) => (
              <span key={status} className="inline-flex items-center gap-1.5">
                <StatusPill status={status} />
                <span className="text-[13px] text-ink-2">{n}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-ink-2">No page status recorded.</p>
        )}
      </Section>

      {carried.length > 0 && (
        <Section label="Carried from earlier turn">
          <p className="flex items-start gap-1.5 text-[13px] text-ink-2">
            <Repeat size={14} className="mt-0.5 shrink-0" />
            <span>
              {carried.length} {carried.length === 1 ? "page" : "pages"} cited earlier in this conversation stayed in
              play: {carried.map((r) => r.label || `chunk ${r.chunk_id}`).join(", ")}.
            </span>
          </p>
        </Section>
      )}

      <Section label="Top evidence">
        <ul className="divide-y divide-rule border-y border-rule">
          {retrieved.slice(0, 6).map((r) => {
            const c = answer.citations[String(r.chunk_id)];
            const status = (c?.status ?? r.status) as PageStatus | undefined;
            return (
              <li key={r.chunk_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-[13px]">
                {c ? (
                  <button onClick={() => onCite(c)} className="font-semibold underline hover:text-orange">
                    {chipText(c)}
                  </button>
                ) : (
                  <span className="font-semibold">
                    {r.label || `chunk ${r.chunk_id}`}
                    {r.page_no ? `, p. ${r.page_no}` : ""}
                  </span>
                )}
                <Mono className="text-ink-2">
                  <Layers size={11} className="mr-1 inline align-[-1px]" />
                  {r.kind}
                </Mono>
                {status && <StatusPill status={status} />}
                {used.has(r.chunk_id) && <Mono className="text-orange">cited</Mono>}
                <span className="ml-auto whitespace-nowrap text-[12px] text-ink-2">
                  score {r.score}
                  {r.rerank != null && ` · rerank ${r.rerank}`}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
    </Card>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <Mono className="text-ink-2">{label}</Mono>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Facts({
  icon,
  label,
  items,
  empty,
}: {
  icon: React.ReactNode;
  label: string;
  items: string[];
  empty: string;
}) {
  return (
    <div>
      <Mono className="flex items-center gap-1.5 text-ink-2">
        {icon}
        {label}
      </Mono>
      {items.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {items.map((t) => (
            <span key={t} className="rounded border-[1.5px] border-ink/15 px-1.5 py-0.5 font-mono text-[12px]">
              {t}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-1.5 text-[13px] text-ink-2">{empty}</p>
      )}
    </div>
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}
