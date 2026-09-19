"use client";

import { useState } from "react";
import { CornerDownRight, NotebookPen, Phone } from "lucide-react";
import { api, type Citation, type Flag } from "@/lib/api";
import { navigate, useAsync, useWide } from "@/lib/hooks";
import { chipText, EvidencePanel } from "./Evidence";
import { Button, Card, ErrorNote, Field, inputCls, Mono, PageTitle, Spinner, when } from "./ui";

/** For document owners: steps technicians flagged that the library could not resolve. */
export function Inbox() {
  const flags = useAsync(() => api.flags(), []);
  const [evidence, setEvidence] = useState<Citation | null>(null);
  const wide = useWide();
  const open = flags.data?.filter((f) => f.status === "open") ?? [];
  const closed = flags.data?.filter((f) => f.status !== "open") ?? [];

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-6 md:px-6 lg:py-10">
      <PageTitle
        title="Escalations"
        lede="When a technician says a step does not match the machine and no verified page explains it, it comes here with their note, photo and the page that was cited. Your fix note becomes a cited source for that machine."
      />
      {flags.error && <ErrorNote>{flags.error}</ErrorNote>}
      {flags.loading && !flags.data && <Spinner />}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          <h2 className="flex items-center gap-2 text-[18px] font-semibold">
            Open <span className="rounded bg-orange px-2 font-mono text-[13px] text-paper">{open.length}</span>
          </h2>
          {flags.data && open.length === 0 && (
            <div className="dots mt-3 rounded-lg border-[1.5px] border-dashed border-rule p-8 text-center text-ink-2">No open escalations.</div>
          )}
          <div className="mt-3 space-y-4">
            {open.map((f) => (
              <OpenFlag key={f.id} f={f} onCite={setEvidence} onResolved={flags.reload} />
            ))}
          </div>

          {closed.length > 0 && (
            <>
              <h2 className="mt-10 text-[18px] font-semibold">Resolved and revised</h2>
              <ul className="mt-3 divide-y divide-rule border-y border-rule">
                {closed.map((f) => (
                  <li key={f.id} className="py-3 text-[14px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] tracking-[0.06em] text-paper ${f.outcome === "revised" ? "bg-ok" : "bg-ink"}`}>
                        {f.outcome === "revised" ? "REVISED BY SEARCH" : "FIX NOTE ADDED"}
                      </span>
                      <span className="font-mono text-[12px]">{f.asset_tag}</span>
                      <span className="text-ink-2">{when(f.created_at)}</span>
                    </div>
                    <p className="mt-1">
                      Step: <span className="text-ink-2">{f.step_text}</span>
                    </p>
                    <p className="mt-0.5">
                      Technician: <span className="text-ink-2">{f.note || "(photo only)"}</span>
                    </p>
                    {f.fix_note && (
                      <p className="mt-1 flex items-start gap-1.5">
                        <NotebookPen size={14} className="mt-0.5 shrink-0 text-orange" />
                        <span>
                          {f.fix_note.text} <span className="text-ink-2">({f.fix_note.author})</span>
                        </span>
                      </p>
                    )}
                    {f.outcome === "revised" && f.revised_query_id && (
                      <button className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold hover:text-orange" onClick={() => navigate("/ask", { q: String(f.revised_query_id) })}>
                        <CornerDownRight size={14} /> See the revised procedure. Consider updating the source document.
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <aside className="hidden lg:block">
          <div className="sticky top-20 h-[calc(100vh-7rem)]">
            {evidence && wide ? (
              <Card className="h-full p-5">
                <EvidencePanel citation={evidence} />
              </Card>
            ) : (
              <div className="dots flex h-full items-center justify-center rounded-lg border-[1.5px] border-dashed border-rule p-10 text-center text-ink-2">
                Select a cited page to compare it with the technician's photo.
              </div>
            )}
          </div>
        </aside>
      </div>
      {evidence && !wide && (
        <div className="fixed inset-0 z-40 flex items-end bg-ink/50" onClick={() => setEvidence(null)}>
          <div className="h-[85vh] w-full rounded-t-2xl bg-paper-2 p-4" onClick={(e) => e.stopPropagation()}>
            <EvidencePanel citation={evidence} onClose={() => setEvidence(null)} />
          </div>
        </div>
      )}
    </div>
  );
}

function OpenFlag({ f, onCite, onResolved }: { f: Flag; onCite: (c: Citation) => void; onResolved: () => void }) {
  const [author, setAuthor] = useState(f.owner);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.fixNote(f.id, author, text);
      onResolved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-orange px-2 py-0.5 font-mono text-[12px] tracking-[0.08em] text-paper">{f.asset_tag ?? "NO ASSET"}</span>
          <span className="text-[14px] font-semibold">{f.asset_name}</span>
        </div>
        <Mono className="text-ink-2">
          To {f.owner || "unassigned"} · {when(f.created_at)}
        </Mono>
      </div>
      <p className="mt-3 text-[13px] text-ink-2">Question: {f.question}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <div className="text-[13px] font-semibold">Flagged step {f.step_index + 1}</div>
          <p className="mt-0.5 rounded-md border-l-[3px] border-ink bg-paper px-3 py-2 text-[15px]">{f.step_text}</p>
          <div className="mt-3 text-[13px] font-semibold">What the technician sees</div>
          <p className="mt-0.5 rounded-md border-l-[3px] border-orange bg-paper px-3 py-2 text-[15px]">{f.note || "(photo only)"}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {f.citations?.map(
              (c) =>
                c && (
                  <button key={c.chunk_id} onClick={() => onCite(c)} className="rounded-md border-[1.5px] border-ink px-2 py-1 text-[12.5px] font-semibold hover:border-orange hover:text-orange">
                    Cited: {chipText(c)}
                  </button>
                ),
            )}
          </div>
        </div>
        {f.photo_url && (
          <a href={f.photo_url} target="_blank" rel="noreferrer">
            <img src={f.photo_url} alt="Technician's photo" className="h-36 w-36 rounded-md border-[1.5px] border-ink object-cover" />
          </a>
        )}
      </div>
      <form onSubmit={submit} className="mt-4 space-y-2 border-t border-rule pt-4">
        <Field label="Fix note" hint="Becomes a cited source for this machine. Write what the technician should do.">
          <textarea className={`${inputCls} resize-none`} rows={3} required value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[180px] flex-1">
            <Field label="Signed">
              <input className={inputCls} value={author} onChange={(e) => setAuthor(e.target.value)} />
            </Field>
          </div>
          {f.owner_contact && (
            <span className="inline-flex items-center gap-1 pb-2.5 text-[13px] text-ink-2">
              <Phone size={13} /> {f.owner_contact}
            </span>
          )}
          <Button type="submit" disabled={busy || text.trim().length < 10}>
            {busy ? <Spinner /> : <NotebookPen size={16} />} Publish fix note
          </Button>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Card>
  );
}
