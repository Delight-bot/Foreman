"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, NotebookPen, Phone, X } from "lucide-react";
import type { Citation } from "@/lib/api";
import { Mono, StatusPill, when } from "./ui";

type Box = [number, number, number, number];

/** A rendered page with one or more regions outlined. Boxes are in PDF points. */
export function PageView({
  src,
  size,
  boxes,
  active,
  onPick,
  className = "",
  scrollToActive = true,
}: {
  src: string;
  size: [number, number];
  boxes: { id: number; bbox: Box | null; label?: string }[];
  active?: number | null;
  onPick?: (id: number) => void;
  className?: string;
  scrollToActive?: boolean;
}) {
  const [w, h] = size;
  const activeRef = useRef<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded && scrollToActive) activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active, loaded, scrollToActive]);
  return (
    <div className={`relative overflow-hidden rounded-md border-[1.5px] border-ink bg-white ${className}`}>
      <img src={src} alt="Manual page" className="block w-full" onLoad={() => setLoaded(true)} />
      {!loaded && <div className="absolute inset-0 animate-pulse bg-rule/40" />}
      {boxes.map((b) => {
        if (!b.bbox) return null;
        const on = b.id === active;
        const pad = 4;
        const style = {
          left: `${((b.bbox[0] - pad) / w) * 100}%`,
          top: `${((b.bbox[1] - pad) / h) * 100}%`,
          width: `${((b.bbox[2] - b.bbox[0] + pad * 2) / w) * 100}%`,
          height: `${((b.bbox[3] - b.bbox[1] + pad * 2) / h) * 100}%`,
        };
        return (
          <div
            key={b.id}
            ref={on ? activeRef : undefined}
            style={style}
            onClick={onPick ? () => onPick(b.id) : undefined}
            className={`absolute rounded-sm ${
              on
                ? "border-[2.5px] border-dashed border-orange bg-orange/10"
                : onPick
                  ? "cursor-pointer border border-ink/25 hover:border-orange hover:bg-orange/5"
                  : "pointer-events-none"
            }`}
          >
            {on && b.label && (
              <span className="absolute -top-[20px] left-0 whitespace-nowrap rounded bg-orange px-1.5 py-0.5 font-mono text-[10px] tracking-[0.06em] text-paper">
                {b.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The receipt behind one step: document, version, page, region, owner and status. */
export function EvidencePanel({ citation, onClose }: { citation: Citation; onClose?: () => void }) {
  const c = citation;
  return (
    <div className="fade-in flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b-[1.5px] border-ink pb-3">
        <div className="min-w-0">
          <Mono className="text-ink-2">Evidence</Mono>
          {c.document ? (
            <>
              <div className="mt-0.5 truncate text-[16px] font-semibold">{c.document.title}</div>
              <div className="text-[13px] text-ink-2">
                {c.document.version && <>{c.document.version} · </>}page {c.page_label ?? c.page_no} · {c.label}
              </div>
            </>
          ) : (
            <div className="mt-0.5 text-[16px] font-semibold">Fix note from {c.author}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill status={c.status} />
          {onClose && (
            <button onClick={onClose} aria-label="Close evidence" className="rounded p-1 hover:bg-rule/60">
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-4">
        {c.kind === "fixnote" ? (
          <div className="rounded-md border-[1.5px] border-ink bg-paper p-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <NotebookPen size={16} className="text-orange" /> Owner's fix note
            </div>
            <p className="mt-2 text-[15px] leading-relaxed">{c.text}</p>
            <div className="mt-3 text-[12px] text-ink-2">
              {c.author}
              {c.created_at && <> · {when(c.created_at)}</>}
            </div>
          </div>
        ) : (
          c.image_url &&
          c.page_size && (
            <PageView
              src={c.image_url}
              size={c.page_size}
              boxes={[{ id: c.chunk_id, bbox: c.bbox, label: labelFor(c) }]}
              active={c.chunk_id}
            />
          )
        )}
        {c.status !== "verified" && c.status_reason && (
          <p className="mt-3 rounded-md border-[1.5px] border-warn px-3 py-2 text-[13px] text-warn">{c.status_reason}</p>
        )}
      </div>

      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 border-t border-rule pt-3 text-[13px]">
        <dt className="text-ink-2">Region</dt>
        <dd>{c.kind === "fixnote" ? "Whole note" : `${kindName(c.kind)} ${c.label}`}</dd>
        <dt className="text-ink-2">Read by</dt>
        <dd>{extractorName(c.extractor)}</dd>
        {c.document && (
          <>
            <dt className="text-ink-2">Source owner</dt>
            <dd className="flex flex-wrap items-center gap-x-2">
              {c.document.owner || "Unassigned"}
              {c.document.owner_contact && (
                <a href={`tel:${c.document.owner_contact.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 font-semibold text-orange">
                  <Phone size={13} /> {c.document.owner_contact}
                </a>
              )}
            </dd>
          </>
        )}
      </dl>
      {c.image_url && (
        <a href={c.image_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold hover:text-orange">
          <ExternalLink size={14} /> Open the full page
        </a>
      )}
    </div>
  );
}

export function labelFor(c: Citation) {
  if (c.kind === "fixnote") return "FIX NOTE";
  if (c.kind === "figure") return "CITED FIGURE";
  if (c.kind === "table") return "CITED TABLE";
  if (c.kind === "table_row") return "CITED ROW";
  if (c.kind === "warning") return "CITED WARNING";
  return "CITED PASSAGE";
}

function kindName(k: Citation["kind"]) {
  return { text: "Passage", warning: "Warning", table: "Table", table_row: "Table row", figure: "Figure", fixnote: "Fix note" }[k];
}

export function extractorName(e: string) {
  return (
    {
      docling: "Docling (text layer)",
      "docling-ocr": "Docling OCR (scanned page)",
      "docling-ocr-retry": "Docling OCR, full-page retry",
      "docling+vlm-caption": "Docling + vision-model caption",
      owner: "Document owner",
      none: "Not readable",
    }[e] ?? e
  );
}

export function chipText(c: Citation) {
  if (c.kind === "fixnote") return `Fix note · ${c.author}`;
  return `${c.label ? `${c.label}, ` : ""}p. ${c.page_label ?? c.page_no}`;
}
