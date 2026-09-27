"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { ArrowLeft, Download, FileUp, Plus, ShieldCheck, ShieldX, Trash2 } from "lucide-react";
import { api, type Asset, type Chunk, type Doc, type Page } from "@/lib/api";
import { navigate, useAsync } from "@/lib/hooks";
import { extractorName, PageView } from "./Evidence";
import { Button, Card, ErrorNote, Field, inputCls, Mono, PageTitle, Spinner, StatusPill } from "./ui";

type Tab = "documents" | "review" | "machines";

export function Library({ tab }: { tab: Tab }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "documents", label: "Documents" },
    { id: "review", label: "Review queue" },
    { id: "machines", label: "Machines & tags" },
  ];
  return (
    <div className="mx-auto max-w-[1180px] px-4 py-6 md:px-6 lg:py-10">
      <PageTitle
        title="Library"
        lede="Engineers curate what Foreman may cite. Pages are checked on the way in; anything that fails is quarantined until an owner reviews it."
      />
      <div className="mb-6 flex gap-1 border-b-[1.5px] border-ink" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => navigate("/library", { tab: t.id })}
            className={`-mb-[1.5px] rounded-t-md border-[1.5px] px-4 py-2 text-[14px] font-semibold ${
              tab === t.id ? "border-ink border-b-paper bg-paper" : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "documents" && <Documents />}
      {tab === "review" && <Review />}
      {tab === "machines" && <Machines />}
    </div>
  );
}

function Documents() {
  const docs = useAsync(api.documents, []);
  const assets = useAsync(api.assets, []);
  const processing = docs.data?.some((d) => d.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => docs.reload(), 1500);
    return () => clearInterval(t);
  }, [processing, docs.reload]);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        {docs.error && <ErrorNote>{docs.error}</ErrorNote>}
        {docs.loading && !docs.data && <Spinner />}
        <ul className="divide-y divide-rule border-y border-rule">
          {docs.data?.map((d) => (
            <li key={d.id}>
              <button onClick={() => navigate(`/library/${d.id}`)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 py-4 text-left hover:bg-paper-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[16px] font-semibold">{d.title}</div>
                  <div className="text-[13px] text-ink-2">
                    {[d.version, d.owner, d.assets.length ? d.assets.join(", ") : "No machines linked"].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <DocStatus d={d} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <Upload assets={assets.data ?? []} onDone={docs.reload} />
    </div>
  );
}

function DocStatus({ d }: { d: Doc }) {
  if (d.status === "processing")
    return (
      <span className="flex items-center gap-2 text-[13px] text-ink-2">
        <Spinner size={15} /> Reading pages
      </span>
    );
  if (d.status === "failed") return <span className="text-[13px] font-semibold text-orange">Failed: {d.error}</span>;
  const s = d.pages_by_status;
  return (
    <span className="flex flex-wrap items-center gap-2 font-mono text-[12px]">
      <span className="text-ink-2">{d.page_count} PP</span>
      {(["verified", "unverified", "quarantined", "rejected"] as const).map(
        (k) =>
          s[k] ? (
            <span key={k} className="flex items-center gap-1">
              <StatusPill status={k} /> {s[k]}
            </span>
          ) : null,
      )}
    </span>
  );
}

function Upload({ assets, onDone }: { assets: Asset[]; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState({ title: "", version: "", owner: "", owner_contact: "", page_from: "", page_to: "" });
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  function pick(f: File | undefined) {
    if (!f) return;
    setFile(f);
    if (!meta.title) setMeta((m) => ({ ...m, title: f.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ") }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await api.upload(file, { ...meta, assets: tags });
      setFile(null);
      setMeta({ title: "", version: "", owner: "", owner_contact: "", page_from: "", page_to: "" });
      setTags([]);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="h-fit p-5">
      <h2 className="text-[17px] font-semibold">Add a document</h2>
      <p className="mt-1 text-[13px] text-ink-2">Manuals, drawings, bulletins. Scanned PDFs are read by the vision model and held for review.</p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            pick(e.dataTransfer.files[0]);
          }}
          className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border-[1.5px] border-dashed px-3 py-5 text-center text-[14px] ${
            drag ? "border-orange bg-orange/5" : "border-ink/50"
          }`}
        >
          <FileUp size={20} />
          {file ? <span className="font-semibold">{file.name}</span> : <span>Drop a PDF or choose a file</span>}
          <input type="file" accept="application/pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <Field label="Title">
          <input className={inputCls} required value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Version">
            <input className={inputCls} placeholder="rev. 2019" value={meta.version} onChange={(e) => setMeta({ ...meta, version: e.target.value })} />
          </Field>
          <Field label="Owner contact">
            <input className={inputCls} placeholder="ext. 4417" value={meta.owner_contact} onChange={(e) => setMeta({ ...meta, owner_contact: e.target.value })} />
          </Field>
        </div>
        <Field label="Pages (optional)" hint="Read only part of a long manual, e.g. the fault tracing chapter. Page numbers stay the manual's own.">
          <div className="flex items-center gap-2">
            <input className={inputCls} inputMode="numeric" placeholder="from" value={meta.page_from} onChange={(e) => setMeta({ ...meta, page_from: e.target.value.replace(/\D/g, "") })} aria-label="First page" />
            <span className="text-ink-2">to</span>
            <input className={inputCls} inputMode="numeric" placeholder="to" value={meta.page_to} onChange={(e) => setMeta({ ...meta, page_to: e.target.value.replace(/\D/g, "") })} aria-label="Last page" />
          </div>
        </Field>
        <Field label="Document owner" hint="Gets review requests and escalations for this document.">
          <input className={inputCls} placeholder="Reliability engineering" value={meta.owner} onChange={(e) => setMeta({ ...meta, owner: e.target.value })} />
        </Field>
        <fieldset>
          <legend className="mb-1 text-[13px] font-semibold">Applies to</legend>
          <div className="flex flex-wrap gap-1.5">
            {assets.map((a) => {
              const on = tags.includes(a.tag);
              return (
                <button
                  type="button"
                  key={a.tag}
                  aria-pressed={on}
                  onClick={() => setTags(on ? tags.filter((t) => t !== a.tag) : [...tags, a.tag])}
                  className={`rounded-md border-[1.5px] px-2 py-1 font-mono text-[12px] ${on ? "border-ink bg-ink text-paper" : "border-ink/40 hover:border-ink"}`}
                >
                  {a.tag}
                </button>
              );
            })}
          </div>
        </fieldset>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" className="w-full" disabled={!file || !meta.title.trim() || busy}>
          {busy ? <Spinner /> : <FileUp size={17} />} Upload and verify
        </Button>
      </form>
    </Card>
  );
}

export function DocDetail({ id }: { id: number }) {
  const doc = useAsync(() => api.document(id), [id]);
  const [pageNo, setPageNo] = useState(1);
  const [chunk, setChunk] = useState<number | null>(null);
  const d = doc.data;
  useEffect(() => {
    if (d?.status !== "processing") return;
    const t = setInterval(() => doc.reload(), 1500);
    return () => clearInterval(t);
  }, [d?.status, doc.reload]);
  const page = d?.pages?.find((p) => p.page_no === pageNo) ?? d?.pages?.[0];
  const selected = page?.chunks.find((c) => c.id === chunk) ?? null;

  async function remove() {
    if (!d || !confirm(`Delete "${d.title}"? Answers that cited it keep their log, but it can no longer be cited.`)) return;
    await api.deleteDocument(d.id);
    navigate("/library");
  }

  return (
    <div>
      <button onClick={() => navigate("/library")} className="mb-4 inline-flex items-center gap-1.5 text-[14px] font-semibold hover:text-orange">
        <ArrowLeft size={16} /> Library
      </button>
      {doc.error && <ErrorNote>{doc.error}</ErrorNote>}
      {d && (
        <>
          <PageTitle
            title={d.title}
            lede={[d.version, d.owner && `Owner: ${d.owner} ${d.owner_contact}`, d.assets.length && `Machines: ${d.assets.join(", ")}`, d.extractor && `Parsed by ${d.extractor}`,
              d.page_from && `Pages ${d.page_from}-${d.page_to ?? "end"} of the manual`]
              .filter(Boolean)
              .join(" · ")}
          >
            <Button variant="secondary" onClick={remove}>
              <Trash2 size={16} /> Delete
            </Button>
          </PageTitle>
          <div className="mb-4">
            <DocStatus d={d} />
          </div>
          {d.pages && d.pages.length > 0 && page && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[120px_minmax(0,1fr)_340px]">
              <nav className="flex gap-1.5 overflow-x-auto pb-2 lg:max-h-[75vh] lg:flex-col lg:overflow-y-auto" aria-label="Pages">
                {d.pages.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setPageNo(p.page_no);
                      setChunk(null);
                    }}
                    className={`flex shrink-0 items-center justify-between gap-2 rounded-md border-[1.5px] px-2 py-1.5 font-mono text-[12px] ${
                      p.page_no === page.page_no ? "border-ink bg-ink text-paper" : "border-rule hover:border-ink"
                    }`}
                  >
                    p. {p.page_no}
                    <span className={`h-2 w-2 rounded-full ${dot(p.status)}`} aria-label={p.status} />
                  </button>
                ))}
              </nav>
              <PageView
                src={page.image_url}
                size={[page.width, page.height]}
                boxes={page.chunks.map((c) => ({ id: c.id, bbox: c.bbox, label: `${c.kind.toUpperCase()} ${c.label}` }))}
                active={chunk}
                onPick={setChunk}
                scrollToActive={false}
              />
              <div>
                <div className="flex items-center gap-2">
                  <StatusPill status={page.status} />
                  <Mono className="text-ink-2">{extractorName(page.extractor)}</Mono>
                </div>
                {page.reason && <p className="mt-2 text-[13px] text-ink-2">{page.reason}</p>}
                <h3 className="mt-4 text-[15px] font-semibold">{page.chunks.length} regions indexed</h3>
                <ul className="mt-2 space-y-1.5">
                  {page.chunks.map((c) => (
                    <ChunkRow key={c.id} c={c} active={c.id === chunk} onClick={() => setChunk(c.id)} />
                  ))}
                </ul>
                {selected && (
                  <pre className="mt-4 max-h-64 overflow-auto rounded-md border-[1.5px] border-ink bg-paper-2 p-3 font-mono text-[11.5px] whitespace-pre-wrap">{selected.text}</pre>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function dot(s: Page["status"]) {
  return { verified: "bg-ok", unverified: "bg-warn", quarantined: "bg-orange", rejected: "bg-ink-2" }[s];
}

function ChunkRow({ c, active, onClick }: { c: Chunk; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`flex w-full items-start gap-2 rounded-md border-[1.5px] px-2 py-1.5 text-left text-[13px] ${active ? "border-orange" : "border-transparent hover:border-rule"}`}
      >
        <Mono className="mt-0.5 w-14 shrink-0 text-ink-2">{c.kind}</Mono>
        <span className="min-w-0 flex-1 truncate">
          {c.label && <span className="font-semibold">{c.label} </span>}
          {c.text.split("\n")[0]}
        </span>
      </button>
    </li>
  );
}

function Review() {
  const q = useAsync(api.review, []);
  const [reviewer, setReviewer] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(p: Page, action: "approve" | "reject") {
    setBusy(p.id);
    setError(null);
    try {
      await api.reviewPage(p.id, action, reviewer);
      q.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <p className="max-w-[620px] text-[15px] text-ink-2">
          <span className="font-semibold text-ink">Quarantined</span> pages cannot be cited until approved.{" "}
          <span className="font-semibold text-ink">Unverified</span> pages can be cited, with a warning to check the original.
          Approving marks a page verified.
        </p>
        <div className="w-56">
          <Field label="Reviewing as">
            <input className={inputCls} value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Your name" />
          </Field>
        </div>
      </div>
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {q.data?.length === 0 && (
        <div className="dots rounded-lg border-[1.5px] border-dashed border-rule p-10 text-center text-ink-2">Nothing waiting for review.</div>
      )}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {q.data?.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-semibold">{p.title}</div>
                <div className="text-[13px] text-ink-2">
                  {p.version} · page {p.page_no} · owner {p.owner || "unassigned"}
                </div>
              </div>
              <StatusPill status={p.status} />
            </div>
            <p className="mt-2 text-[13px]">{p.reason}</p>
            <PageView className="mt-3" src={p.image_url} size={[p.width, p.height]} boxes={p.chunks.map((c) => ({ id: c.id, bbox: c.bbox }))} />
            {p.chunks.length > 0 ? (
              <details className="mt-2 text-[13px]">
                <summary className="cursor-pointer font-semibold">Machine reading ({p.chunks.length} regions)</summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded bg-paper p-2 font-mono text-[11.5px] whitespace-pre-wrap">
                  {p.chunks.map((c) => c.text).join("\n\n")}
                </pre>
              </details>
            ) : (
              <p className="mt-2 text-[13px] text-ink-2">No text could be read from this page.</p>
            )}
            <div className="mt-3 flex gap-2">
              <Button onClick={() => act(p, "approve")} disabled={busy === p.id || p.chunks.length === 0} className="flex-1">
                <ShieldCheck size={16} /> Approve
              </Button>
              <Button variant="secondary" onClick={() => act(p, "reject")} disabled={busy === p.id} className="flex-1">
                <ShieldX size={16} /> Reject
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

const LABEL_BASE_KEY = "foreman.labelBase";

function Machines() {
  const assets = useAsync(api.assets, []);
  const [form, setForm] = useState({ tag: "", name: "", location: "" });
  const [error, setError] = useState<string | null>(null);
  // Labels are printed once and stay on the machine, so they point at a fixed address:
  // the plant's Foreman URL, or an HTTPS tunnel while demoing. Kept per browser.
  const [labelBase, setLabelBase] = useState("");
  useEffect(() => {
    setLabelBase(localStorage.getItem(LABEL_BASE_KEY) || window.location.origin);
  }, []);
  const saveBase = (v: string) => {
    setLabelBase(v);
    try {
      localStorage.setItem(LABEL_BASE_KEY, v);
    } catch {
      /* private window */
    }
  };

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createAsset(form);
      setForm({ tag: "", name: "", location: "" });
      assets.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <Card className="mb-5 p-4">
          <Field
            label="Address printed on the labels"
            hint={
              window.location.origin === labelBase
                ? "Labels open this address. For phones, use the plant URL or an HTTPS tunnel address instead of localhost."
                : `Labels open ${labelBase}, not the address you are browsing.`
            }
          >
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={labelBase}
                onChange={(e) => saveBase(e.target.value.trim().replace(/\/$/, ""))}
                placeholder="https://foreman.plant.local"
                aria-label="Address printed on the labels"
              />
              <Button variant="secondary" type="button" onClick={() => saveBase(window.location.origin)} className="shrink-0 py-2">
                Use this one
              </Button>
            </div>
          </Field>
        </Card>
        <div className="grid gap-4 sm:grid-cols-2">
          {assets.data?.map((a) => <AssetCard key={a.tag} a={a} base={labelBase} />)}
        </div>
      </div>
      <Card className="h-fit p-5">
        <h2 className="text-[17px] font-semibold">Add a machine</h2>
        <form onSubmit={add} className="mt-4 space-y-3">
          <Field label="Tag" hint="Printed on the QR label, e.g. CV-12">
            <input className={`${inputCls} font-mono uppercase`} required value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} />
          </Field>
          <Field label="Name">
            <input className={inputCls} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Location">
            <input className={inputCls} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </Field>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" className="w-full">
            <Plus size={17} /> Add machine
          </Button>
        </form>
      </Card>
    </div>
  );
}

function AssetCard({ a, base }: { a: Asset; base: string }) {
  const link = useMemo(() => `${base}/ask?asset=${encodeURIComponent(a.tag)}`, [a.tag, base]);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!base) return;
    QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: "#1b2028", light: "#fbfaf7" } }).then(setQr);
  }, [link, base]);
  return (
    <Card className="p-4">
      <div className="flex gap-4">
        {qr && <img src={qr} alt={`QR tag for ${a.tag}`} className="h-28 w-28 rounded border-[1.5px] border-ink" />}
        <div className="min-w-0">
          <span className="rounded bg-orange px-2 py-0.5 font-mono text-[12px] tracking-[0.08em] text-paper">{a.tag}</span>
          <div className="mt-2 text-[15px] font-semibold">{a.name}</div>
          <div className="text-[13px] text-ink-2">{a.location}</div>
          <div className="mt-1 text-[12px] text-ink-2">
            {a.documents?.length ?? 0} documents
            {a.open_flags ? <span className="font-semibold text-orange"> · {a.open_flags} open escalation{a.open_flags > 1 ? "s" : ""}</span> : null}
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" className="flex-1 py-2 text-[13px]" onClick={() => navigate("/ask", { asset: a.tag })}>
          Open
        </Button>
        {qr && (
          <a href={qr} download={`foreman-${a.tag}.png`} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border-[1.5px] border-ink py-2 text-[13px] font-semibold hover:border-orange hover:text-orange">
            <Download size={14} /> QR label
          </a>
        )}
      </div>
      <p className="mt-2 truncate font-mono text-[10.5px] text-ink-2" title={link}>
        {link}
      </p>
    </Card>
  );
}
