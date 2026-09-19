"use client";

import { useState } from "react";
import { api, type Answer } from "@/lib/api";
import { navigate, useAsync } from "@/lib/hooks";
import { ErrorNote, Mono, PageTitle, Spinner, when } from "./ui";

const badge: Record<string, string> = {
  verified: "bg-ok",
  unverified: "bg-warn",
  not_found: "bg-ink-2",
};

/** Every answer is logged: query, retrieved chunks, model, final text. Replayable when something goes wrong. */
export function Log() {
  const rows = useAsync(api.queries, []);
  const [open, setOpen] = useState<Answer | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  async function show(id: number) {
    setLoadingId(id);
    try {
      setOpen(await api.query(id));
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-6 md:px-6 lg:py-10">
      <PageTitle title="Answer history" lede="Every answer is logged with the question, what was retrieved, the model and the final text, so any answer can be traced when something goes wrong." />
      {rows.error && <ErrorNote>{rows.error}</ErrorNote>}
      {rows.loading && !rows.data && <Spinner />}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[14px]">
            <thead className="border-b-[1.5px] border-ink text-[12px]">
              <tr>
                <th className="py-2 pr-2 font-mono font-medium tracking-[0.06em]">#</th>
                <th className="py-2 pr-2 font-mono font-medium tracking-[0.06em]">MACHINE</th>
                <th className="py-2 pr-2 font-mono font-medium tracking-[0.06em]">QUESTION</th>
                <th className="py-2 pr-2 font-mono font-medium tracking-[0.06em]">RESULT</th>
                <th className="py-2 font-mono font-medium tracking-[0.06em]">WHEN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {rows.data?.map((r) => (
                <tr key={r.id} onClick={() => show(r.id)} className={`cursor-pointer hover:bg-paper-2 ${open?.id === r.id ? "bg-paper-2" : ""}`}>
                  <td className="py-2.5 pr-2 font-mono text-[12px]">{loadingId === r.id ? <Spinner size={13} /> : r.id}</td>
                  <td className="py-2.5 pr-2 font-mono text-[12px]">{r.asset_tag ?? "ALL"}</td>
                  <td className="max-w-[260px] truncate py-2.5 pr-2">
                    {r.parent_id && <span className="mr-1 text-orange">↳ revision of #{r.parent_id}</span>}
                    {r.question || "(photo)"}
                  </td>
                  <td className="py-2.5 pr-2">
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] text-paper uppercase ${badge[r.confidence]}`}>{r.confidence.replace("_", " ")}</span>
                    {r.flags > 0 && <span className="ml-1.5 font-mono text-[11px] text-orange">{r.flags} FLAG</span>}
                  </td>
                  <td className="py-2.5 text-[12px] whitespace-nowrap text-ink-2">{when(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {open && <Detail a={open} />}
      </div>
    </div>
  );
}

function Detail({ a }: { a: Answer }) {
  return (
    <div className="fade-in rounded-lg border-[1.5px] border-ink bg-paper-2 p-5 text-[14px]">
      <div className="flex items-center justify-between">
        <Mono>Answer #{a.id}</Mono>
        <button className="text-[13px] font-semibold hover:text-orange" onClick={() => navigate("/ask", { ...(a.asset ? { asset: a.asset.tag } : {}), q: String(a.id) })}>
          Open in technician view
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-ink-2">Question</dt>
        <dd>{a.question || "(photo)"}</dd>
        <dt className="text-ink-2">Machine</dt>
        <dd>{a.asset ? `${a.asset.tag} · ${a.asset.name}` : "Whole library"}</dd>
        <dt className="text-ink-2">Mode</dt>
        <dd>{a.mode === "model" ? `Model: ${a.model}` : "Extractive (no model)"}</dd>
        <dt className="text-ink-2">Confidence</dt>
        <dd>{a.confidence}</dd>
        {a.understanding?.observation && (
          <>
            <dt className="text-ink-2">Photo reading</dt>
            <dd>{a.understanding.observation}</dd>
          </>
        )}
        {a.revised_reason && (
          <>
            <dt className="text-ink-2">Revised because</dt>
            <dd>{a.revised_reason}</dd>
          </>
        )}
      </dl>
      <h3 className="mt-4 font-semibold">Retrieved</h3>
      <p className="text-[12px] text-ink-2">Qdrant hybrid search (semantic + BM25 + exact codes), Neo4j graph links, cross-encoder rerank.</p>
      <ol className="mt-1 space-y-1 font-mono text-[12px]">
        {a.retrieved.map((r) => (
          <li key={r.chunk_id}>
            chunk {r.chunk_id} · {r.kind} {r.label} {r.page_no ? `p. ${r.page_no}` : ""} · score {r.score}
            <span className="text-ink-2">
              {r.rerank != null && <> · rerank {r.rerank}</>}
              {r.codes && r.codes.length > 0 && <> · exact {r.codes.join(", ")}</>}
            </span>
            {r.graph && r.graph.length > 0 && <span className="text-orange"> · graph via {r.graph.join(", ")}</span>}
          </li>
        ))}
      </ol>
      <h3 className="mt-4 font-semibold">Final text</h3>
      <ol className="mt-1 list-decimal space-y-1 pl-5">
        {a.warnings.map((w, i) => (
          <li key={`w${i}`} className="text-orange">
            {w.text} <span className="font-mono text-[11px]">[{w.chunk_ids.join(", ")}]</span>
          </li>
        ))}
        {a.steps.map((s, i) => (
          <li key={i}>
            {s.text} <span className="font-mono text-[11px] text-ink-2">[{s.chunk_ids.join(", ")}]</span>
          </li>
        ))}
      </ol>
      {a.gap && <p className="mt-2 text-ink-2">Gap: {a.gap}</p>}
      {a.dropped.length > 0 && (
        <>
          <h3 className="mt-4 font-semibold">Removed by the claim check</h3>
          <ul className="mt-1 list-disc pl-5 text-ink-2">
            {a.dropped.map((d, i) => (
              <li key={i}>
                {d.text} ({d.reason})
              </li>
            ))}
          </ul>
        </>
      )}
      {a.flags.length > 0 && (
        <>
          <h3 className="mt-4 font-semibold">Flags</h3>
          <ul className="mt-1 list-disc pl-5">
            {a.flags.map((f) => (
              <li key={f.id}>
                Step {f.step_index + 1}: "{f.note}" → {f.outcome}
                {f.revised_query_id && <> (#{f.revised_query_id})</>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
