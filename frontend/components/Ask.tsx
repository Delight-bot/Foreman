"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  CircleCheck,
  CornerDownRight,
  Flag as FlagIcon,
  Mic,
  MicOff,
  Phone,
  QrCode,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";
import { api, type Answer, type Asset, type Citation, type FlagResult } from "@/lib/api";
import { navigate, shrinkImage, useAsync, useSpeech, useWide } from "@/lib/hooks";
import { chipText, EvidencePanel } from "./Evidence";
import { Scanner } from "./Scanner";
import { Button, Card, ConfidenceBanner, ErrorNote, Mono, Spinner, inputCls, when } from "./ui";

const THINKING = [
  "Reading your question",
  "Searching this machine's manuals and drawings",
  "Drafting steps from the pages found",
  "Checking every step against its page",
];

export function Ask({ tag, queryId }: { tag: string | null; queryId: number | null }) {
  const assets = useAsync(api.assets, []);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const [question, setQuestion] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  // The conversation, oldest first. The last turn is the live one: every interaction below
  // (steps ticked off, a step flagged, a revision) applies to it, exactly as it always did.
  const [thread, setThread] = useState<Answer[]>([]);
  const answer = thread.length ? thread[thread.length - 1] : null;
  const earlier = thread.slice(0, -1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Citation | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [flagging, setFlagging] = useState<number | null>(null);
  const [escalation, setEscalation] = useState<FlagResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const wide = useWide();

  useEffect(() => {
    if (!tag) {
      setAsset(null);
      return;
    }
    setAssetError(null);
    api
      .asset(tag)
      .then(setAsset)
      .catch((e: Error) => {
        setAsset(null);
        setAssetError(e.message);
      });
  }, [tag]);

  useEffect(() => {
    if (queryId == null) return;
    api
      .query(queryId)
      .then((a) => {
        setThread([a]);
        setQuestion(a.question);
        setDone(new Set());
      })
      .catch((e: Error) => setError(e.message));
  }, [queryId]);

  const pickAsset = useCallback((t: string) => {
    setScanning(false);
    setThread([]);
    setEscalation(null);
    setEvidence(null);
    navigate("/ask", { asset: t });
  }, []);

  /** Leave the conversation and start again on the same machine. */
  const startOver = useCallback(() => {
    setThread([]);
    setQuestion("");
    setPhoto(null);
    setEscalation(null);
    setEvidence(null);
    setNotice(null);
    setDone(new Set());
  }, []);

  const speech = useSpeech(setQuestion);

  async function submit() {
    if (!question.trim() && !photo) return;
    const continuing = answer;
    setLoading(true);
    setError(null);
    setEscalation(null);
    setEvidence(null);
    setNotice(null);
    try {
      // The URL names the machine; do not wait for its details to load before asking about it.
      const a = await api.ask(asset?.tag ?? tag ?? "", question.trim(), photo, continuing?.id ?? null);
      setThread((t) => (continuing ? [...t, a] : [a]));
      setQuestion("");
      setPhoto(null);
      setDone(new Set());
      setTimeout(() => answerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function onFlagResult(r: FlagResult, stepIndex: number) {
    setFlagging(null);
    if (r.outcome === "revised" && r.revised) {
      const revised = r.revised;
      setThread((t) => (t.length ? [...t.slice(0, -1), revised] : [revised]));
      setEscalation(null);
      setNotice(`Step ${stepIndex + 1} was revised with a new citation.`);
      const d = new Set([...done].filter((i) => i < stepIndex));
      setDone(d);
    } else {
      setEscalation(r);
      setNotice(null);
    }
  }

  const current = answer ? answer.steps.findIndex((_, i) => !done.has(i)) : -1;

  return (
    <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-8 px-4 py-6 md:px-6 lg:grid-cols-[minmax(0,560px)_1fr] lg:py-10">
      <div className="min-w-0">
        <AssetBar
          asset={asset}
          error={assetError}
          assets={assets.data ?? []}
          onScan={() => setScanning(true)}
          onPick={pickAsset}
        />

        <Card className="mt-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="q" className="text-[15px] font-semibold">
              {answer ? "Ask a follow-up" : "What is wrong?"}
            </label>
            {answer && (
              <button type="button" onClick={startOver} className="text-[13px] text-ink-2 underline hover:text-orange">
                New question
              </button>
            )}
          </div>
          <textarea
            id="q"
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            placeholder={
              answer
                ? `Follow up, e.g. "and what is the torque spec?"`
                : asset
                  ? `Say or type the fault on ${asset.tag}, e.g. "stopped with E-42"`
                  : "Scan the machine first, or ask across the whole library"
            }
            className={`${inputCls} mt-2 resize-none text-[16px]`}
          />
          <PhotoPreview photo={photo} onClear={() => setPhoto(null)} />
          {speech.error && <p className="mt-2 text-[13px] text-orange">{speech.error}</p>}
          <div className="mt-3 flex items-center gap-2">
            {speech.supported && (
              <Button
                type="button"
                variant={speech.listening ? "orange" : "secondary"}
                onClick={speech.listening ? speech.stop : speech.start}
                aria-label={speech.listening ? "Stop listening" : "Speak the fault"}
                className="px-3"
              >
                {speech.listening ? <ListeningBars /> : <Mic size={18} />}
                <span className="hidden sm:inline">{speech.listening ? "Listening" : "Speak"}</span>
              </Button>
            )}
            <PhotoButton onPhoto={setPhoto} />
            <Button className="ml-auto" onClick={submit} disabled={loading || (!question.trim() && !photo)}>
              {loading ? <Spinner /> : <Send size={17} />} {answer ? "Follow up" : "Ask Foreman"}
            </Button>
          </div>
        </Card>

        {loading && <Thinking />}
        {error && (
          <div className="mt-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}

        {earlier.map((t) => (
          <PastTurn key={t.id} answer={t} active={evidence?.chunk_id ?? null} onCite={setEvidence} />
        ))}

        {answer && !loading && (
          <div ref={answerRef} className="fade-in mt-6 scroll-mt-20">
            <AnswerView
              answer={answer}
              done={done}
              current={current}
              active={evidence?.chunk_id ?? null}
              notice={notice}
              onToggle={(i) => {
                const d = new Set(done);
                if (d.has(i)) d.delete(i);
                else d.add(i);
                setDone(d);
              }}
              onCite={(c) => setEvidence(c)}
              onFlag={(i) => setFlagging(i)}
              escalation={escalation}
            />
          </div>
        )}

        {!answer && !loading && asset?.recent && asset.recent.length > 0 && (
          <div className="mt-8">
            <Mono className="text-ink-2">Recent on {asset.tag}</Mono>
            <ul className="mt-2 divide-y divide-rule border-y border-rule">
              {asset.recent.map((r) => (
                <li key={r.id}>
                  <button className="flex w-full items-center justify-between gap-3 py-3 text-left hover:text-orange" onClick={() => navigate("/ask", { asset: asset.tag, q: String(r.id) })}>
                    <span className="truncate text-[15px]">{r.question || "(photo)"}</span>
                    <span className="shrink-0 text-[12px] text-ink-2">{when(r.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Evidence: side panel on wide screens, bottom sheet on phones. */}
      <aside className="hidden lg:block">
        <div className="sticky top-20 h-[calc(100vh-7rem)]">
          {evidence && wide ? (
            <Card className="h-full p-5">
              <EvidencePanel citation={evidence} />
            </Card>
          ) : (
            <div className="dots flex h-full items-center justify-center rounded-lg border-[1.5px] border-dashed border-rule p-10 text-center text-[15px] text-ink-2">
              {answer ? "Select a citation on any step to see the page it came from." : "The page behind each step appears here."}
            </div>
          )}
        </div>
      </aside>
      {evidence && !wide && (
        <div className="fixed inset-0 z-40 flex items-end bg-ink/50" onClick={() => setEvidence(null)}>
          <div className="max-h-[88vh] w-full overflow-hidden rounded-t-2xl bg-paper-2 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="h-[80vh]">
              <EvidencePanel citation={evidence} onClose={() => setEvidence(null)} />
            </div>
          </div>
        </div>
      )}

      {scanning && <Scanner onTag={pickAsset} onClose={() => setScanning(false)} />}
      {flagging != null && answer && (
        <FlagSheet
          answer={answer}
          stepIndex={flagging}
          onClose={() => setFlagging(null)}
          onResult={(r) => onFlagResult(r, flagging)}
        />
      )}
    </div>
  );
}

function AssetBar({
  asset,
  error,
  assets,
  onScan,
  onPick,
}: {
  asset: Asset | null;
  error: string | null;
  assets: Asset[];
  onScan: () => void;
  onPick: (tag: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b-[1.5px] border-ink/80 px-4 py-3">
        {asset ? (
          <div className="min-w-0">
            <Mono className="text-[12px] text-ink">{asset.name}</Mono>
            <div className="truncate text-[13px] text-ink-2">
              {asset.location} · {asset.documents?.length ?? 0} document{asset.documents?.length === 1 ? "" : "s"}
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <div className="text-[15px] font-semibold">No machine selected</div>
            <div className="text-[13px] text-ink-2">Scan the QR tag so Foreman searches the right manuals.</div>
          </div>
        )}
        {asset && <span className="shrink-0 rounded-md bg-orange px-2.5 py-1.5 font-mono text-[12px] tracking-[0.08em] text-paper">{asset.tag}</span>}
      </div>
      <div className="flex items-center gap-2 px-4 py-2.5">
        <Button variant="secondary" onClick={onScan} className="py-2">
          <QrCode size={17} /> Scan tag
        </Button>
        <select
          aria-label="Choose machine"
          value={asset?.tag ?? ""}
          onChange={(e) => (e.target.value ? onPick(e.target.value) : navigate("/ask"))}
          className="min-w-0 flex-1 rounded-md border-[1.5px] border-ink/40 bg-paper-2 px-2 py-2 text-[14px]"
        >
          <option value="">Whole library</option>
          {assets.map((a) => (
            <option key={a.tag} value={a.tag}>
              {a.tag} · {a.name}
            </option>
          ))}
        </select>
      </div>
      {error && <div className="px-4 pb-3 text-[13px] text-orange">{error}</div>}
    </Card>
  );
}

function PhotoButton({ onPhoto, label = "Photo" }: { onPhoto: (b: Blob) => void; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button type="button" variant="secondary" className="px-3" onClick={() => input.current?.click()} aria-label="Add a photo">
        <Camera size={18} />
        <span className="hidden sm:inline">{label}</span>
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) onPhoto(await shrinkImage(f));
          e.target.value = "";
        }}
      />
    </>
  );
}

function PhotoPreview({ photo, onClear }: { photo: Blob | null; onClear: () => void }) {
  const url = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  if (!url) return null;
  return (
    <div className="relative mt-3 inline-block">
      <img src={url} alt="Your photo" className="h-24 rounded-md border-[1.5px] border-ink object-cover" />
      <button onClick={onClear} aria-label="Remove photo" className="absolute -right-2 -top-2 rounded-full bg-ink p-1 text-paper hover:bg-orange">
        <X size={13} />
      </button>
    </div>
  );
}

function ListeningBars() {
  return (
    <span className="flex h-[18px] items-center gap-[3px]" aria-hidden="true">
      {[0, 120, 240, 90].map((d, i) => (
        <i key={i} className="mic-bar block h-full w-[3px] rounded bg-paper" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

function Thinking() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(x + 1, THINKING.length - 1)), 1500);
    return () => clearInterval(t);
  }, []);
  return (
    <ol className="mt-6 space-y-2" aria-live="polite">
      {THINKING.map((t, n) => (
        <li key={t} className={`flex items-center gap-2.5 text-[14px] ${n > i ? "text-ink-2/50" : ""}`}>
          {n < i ? <Check size={16} className="text-ok" /> : n === i ? <Spinner size={16} className="text-orange" /> : <span className="w-4" />}
          {t}
        </li>
      ))}
    </ol>
  );
}

/** An earlier turn: what was asked and what was answered, its citations still openable.
 *  Only the live turn is worked through, so past turns have no checkboxes and no flagging. */
function PastTurn({ answer, active, onCite }: { answer: Answer; active: number | null; onCite: (c: Citation) => void }) {
  return (
    <Card className="mt-4 border-dashed p-4">
      <div className="flex items-start gap-2">
        <CornerDownRight size={15} className="mt-[3px] shrink-0 text-ink-2" />
        <p className="text-[15px] font-semibold">{answer.question || "(photo)"}</p>
      </div>
      {answer.steps.length > 0 ? (
        <ol className="mt-2 list-decimal space-y-1.5 pl-10 text-[14px] text-ink-2">
          {answer.steps.map((s, i) => (
            <li key={i}>
              {s.text}
              {s.chunk_ids.map((cid) => {
                const c = answer.citations[String(cid)];
                return c ? <CiteChip key={cid} c={c} active={active === cid} onClick={() => onCite(c)} /> : null;
              })}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 pl-7 text-[14px] text-ink-2">{answer.gap || "No answer."}</p>
      )}
    </Card>
  );
}

function CiteChip({ c, active, onClick }: { c: Citation; active: boolean; onClick: () => void }) {
  const warn = c.status !== "verified";
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-md border-[1.5px] px-2 py-1 text-[12.5px] font-semibold transition-colors ${
        active
          ? "border-orange bg-orange text-paper"
          : warn
            ? "border-warn text-warn hover:bg-warn hover:text-paper"
            : "border-ink text-ink hover:border-orange hover:text-orange"
      }`}
    >
      {warn ? <TriangleAlert size={13} /> : <CircleCheck size={13} />}
      {chipText(c)}
    </button>
  );
}

function AnswerView({
  answer,
  done,
  current,
  active,
  notice,
  escalation,
  onToggle,
  onCite,
  onFlag,
}: {
  answer: Answer;
  done: Set<number>;
  current: number;
  active: number | null;
  notice: string | null;
  escalation: FlagResult | null;
  onToggle: (i: number) => void;
  onCite: (c: Citation) => void;
  onFlag: (i: number) => void;
}) {
  const cite = (id: number) => answer.citations[String(id)];
  const revisedSet = new Set(answer.revised_indices ?? []);
  const paused = escalation ? escalation.flag.step_index : -1;
  const closest = answer.closest != null ? cite(answer.closest) : null;

  return (
    <div>
      <ConfidenceBanner value={answer.confidence} />
      {notice && (
        <div className="fade-in mt-3 flex items-center gap-2 rounded-md bg-ink px-3 py-2.5 text-[14px] text-paper">
          <CornerDownRight size={16} className="text-orange" /> {notice}
        </div>
      )}
      {answer.understanding?.observation && (
        <p className="mt-3 text-[14px] text-ink-2">
          <span className="font-semibold text-ink">Photo shows:</span> {answer.understanding.observation}
        </p>
      )}

      {answer.warnings.length > 0 && (
        <section className="mt-4 rounded-md border-[2px] border-orange bg-orange/8 p-4" aria-label="Warnings">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-orange">
            <TriangleAlert size={17} /> Before you start
          </div>
          <ul className="mt-2 space-y-3">
            {answer.warnings.map((w, i) => (
              <li key={i}>
                <p className="text-[15px] leading-snug font-medium">{w.text}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {w.chunk_ids.map((id) => cite(id) && <CiteChip key={id} c={cite(id)} active={active === id} onClick={() => onCite(cite(id))} />)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {answer.steps.length > 0 && (
        <section className="mt-5" aria-label="Procedure">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[18px] font-semibold">Procedure</h2>
            <Mono className="text-ink-2">
              {done.size} of {answer.steps.length} done
            </Mono>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded bg-rule">
            <div className="h-full bg-orange transition-all" style={{ width: `${(done.size / answer.steps.length) * 100}%` }} />
          </div>
          <ol className="mt-3 space-y-2.5">
            {answer.steps.map((s, i) => {
              const isDone = done.has(i);
              const isCurrent = i === current && paused < 0;
              const revised = revisedSet.has(i);
              const blocked = paused >= 0 && i >= paused;
              return (
                <li
                  key={i}
                  className={`rounded-lg border-[1.5px] p-3.5 transition-colors ${
                    isCurrent ? "border-ink bg-paper-2 shadow-[3px_3px_0_0_var(--color-ink)]" : blocked ? "border-rule bg-paper opacity-60" : "border-rule bg-paper-2"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => onToggle(i)}
                      disabled={blocked}
                      aria-label={isDone ? `Mark step ${i + 1} not done` : `Mark step ${i + 1} done`}
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[1.5px] font-mono text-[13px] ${
                        isDone ? "border-ok bg-ok text-paper" : isCurrent ? "border-ink bg-ink text-paper" : "border-ink/60"
                      }`}
                    >
                      {isDone ? <Check size={15} /> : i + 1}
                    </button>
                    <div className="min-w-0 flex-1">
                      {revised && (
                        <span className="mb-1 inline-block rounded bg-orange px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-paper">
                          REVISED
                        </span>
                      )}
                      <p className={`text-[16px] leading-snug ${isDone ? "text-ink-2 line-through decoration-ink-2/40" : ""}`}>{s.text}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {s.chunk_ids.map((id) => cite(id) && <CiteChip key={id} c={cite(id)} active={active === id} onClick={() => onCite(cite(id))} />)}
                        {!isDone && !blocked && (
                          <button
                            onClick={() => onFlag(i)}
                            className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-semibold text-ink-2 hover:text-orange"
                          >
                            <FlagIcon size={13} /> Not what I see
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {current === -1 && paused < 0 && (
            <div className="fade-in mt-4 flex items-center gap-2 rounded-md border-[1.5px] border-ok px-3 py-2.5 text-[14px] text-ok">
              <CircleCheck size={17} /> All steps done. Record the fix on the work order.
            </div>
          )}
        </section>
      )}

      {escalation && <EscalationCard r={escalation} />}

      {answer.confidence === "not_found" && (
        <section className="mt-4 rounded-md border-[1.5px] border-ink bg-paper-2 p-4">
          <div className="text-[14px] font-semibold">What is missing</div>
          <p className="mt-1 text-[15px]">{answer.gap}</p>
          {closest && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
              Closest page: <CiteChip c={closest} active={active === closest.chunk_id} onClick={() => onCite(closest)} />
            </div>
          )}
        </section>
      )}
      {answer.confidence !== "not_found" && answer.gap && <p className="mt-4 text-[14px] text-ink-2"><span className="font-semibold text-ink">Not covered: </span>{answer.gap}</p>}

      {answer.dropped.length > 0 && (
        <details className="mt-4 text-[13px] text-ink-2">
          <summary className="cursor-pointer">
            {answer.dropped.length} claim{answer.dropped.length > 1 ? "s" : ""} removed: not supported by the cited page
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {answer.dropped.map((d, i) => (
              <li key={i}>
                <span className="line-through">{d.text}</span> ({d.reason})
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="mt-6 font-mono text-[11px] tracking-[0.06em] text-ink-2">
        ANSWER #{answer.id} LOGGED · {answer.mode === "model" ? answer.model.toUpperCase() : "EXTRACTIVE MODE"}
        {answer.parent_id && <> · REVISION OF #{answer.parent_id}</>}
      </p>
    </div>
  );
}

function EscalationCard({ r }: { r: FlagResult }) {
  const f = r.flag;
  return (
    <section className="fade-in mt-5 rounded-lg border-[2px] border-ink bg-paper-2 p-4" aria-live="polite">
      <div className="flex items-center gap-2">
        <span className="rounded bg-ink px-2 py-1 font-mono text-[11px] tracking-[0.08em] text-paper">ESCALATED</span>
        <span className="text-[14px] font-semibold">Procedure paused at step {f.step_index + 1}</span>
      </div>
      <p className="mt-2 text-[15px]">
        No verified page accounts for what you see, so Foreman will not guess. Your note, photo, the original citation and what was searched went to{" "}
        <span className="font-semibold">{f.owner || "the document owner"}</span>.
      </p>
      {f.owner_contact && (
        <a
          href={`tel:${f.owner_contact.replace(/[^\d+]/g, "")}`}
          className="mt-3 inline-flex items-center gap-2 rounded-md bg-orange px-4 py-2.5 text-[15px] font-semibold text-paper hover:bg-ink"
        >
          <Phone size={17} /> Call {f.owner || "owner"} · {f.owner_contact}
        </a>
      )}
      {r.tried.length > 0 && (
        <p className="mt-3 text-[13px] text-ink-2">
          Also checked: {r.tried.map((t) => (t.page_no ? `${t.label || "passage"} p. ${t.page_no}` : "fix notes")).join(", ")}
        </p>
      )}
      <p className="mt-2 text-[13px] text-ink-2">The owner's fix note becomes a cited source for the next technician who hits this.</p>
    </section>
  );
}

function FlagSheet({
  answer,
  stepIndex,
  onClose,
  onResult,
}: {
  answer: Answer;
  stepIndex: number;
  onClose: () => void;
  onResult: (r: FlagResult) => void;
}) {
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const speech = useSpeech(setNote);
  const step = answer.steps[stepIndex];

  async function send() {
    setBusy(true);
    setError(null);
    try {
      onResult(await api.flag(answer.id, stepIndex, note.trim(), photo));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="flag-title">
      <div className="w-full max-w-[520px] rounded-t-2xl bg-paper p-5 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Mono className="text-orange">Step {stepIndex + 1} paused</Mono>
            <h2 id="flag-title" className="mt-1 text-[19px] font-semibold">
              Tell Foreman what is different
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-rule/60" disabled={busy}>
            <X size={20} />
          </button>
        </div>
        <p className="mt-3 rounded-md border-l-[3px] border-ink bg-paper-2 px-3 py-2 text-[14px] text-ink-2">{step.text}</p>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. There is no K3, that slot says SPARE. The relay is labeled K4."
          className={`${inputCls} mt-3 resize-none text-[16px]`}
          autoFocus
        />
        <PhotoPreview photo={photo} onClear={() => setPhoto(null)} />
        <p className="mt-2 text-[12px] text-ink-2">Used to search again. It is never added to the manuals.</p>
        {error && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        <div className="mt-4 flex items-center gap-2">
          {speech.supported && (
            <Button type="button" variant={speech.listening ? "orange" : "secondary"} className="px-3" onClick={speech.listening ? speech.stop : speech.start} aria-label="Speak">
              {speech.listening ? <MicOff size={18} /> : <Mic size={18} />}
            </Button>
          )}
          <PhotoButton onPhoto={setPhoto} label="Photo of panel" />
          <Button className="ml-auto" onClick={send} disabled={busy || (!note.trim() && !photo)}>
            {busy ? <Spinner /> : <FlagIcon size={16} />} {busy ? "Searching again" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
