"""Ingest and verify: Docling turns each PDF into page-anchored chunks with provenance.

Docling does layout detection, OCR and table structure. Each heading, paragraph, list,
table and figure keeps its page and bounding box, so every answer can point at the region
it came from. Figures are captioned by the vision model when it is available.

Verification, per page:
  text layer present                  -> verified
  scanned, Docling OCR score is good  -> unverified (citable, with "check the original")
  scanned, low score                  -> retried with full-page OCR at higher resolution,
                                         then quarantined if still low
  scanned, vision-model check finds a misread number or code -> quarantined
Quarantined pages are not indexed as citable until an owner approves them.
"""
import logging
import math
import os
import re
import threading
from importlib.metadata import version as pkg_version

import pymupdf
from pydantic import BaseModel

from . import config, db, graph, index, llm

log = logging.getLogger("foreman.ingest")

HEADING = re.compile(r"^(\d+(?:\.\d+)*)\s+[A-Z]")  # "4.2.3 Relay board", not "1. Stop the drive"
TABLE_LABEL = re.compile(r"^\s*Table\s+([\w.-]+)", re.I)
FIG_LABEL = re.compile(r"^\s*Fig(?:ure)?\.?\s+([\w.-]+)", re.I)
WARNING = re.compile(r"^\s*(WARNING|DANGER|CAUTION)\b", re.I)
MAX_CHUNK_CHARS = 900
MIN_ROWS_TO_SPLIT = 4  # tables at least this long are also indexed row by row
MARGIN_BAND = 60  # running headers and footers live within this many points of the edge
PAGE_DPI = 110
CROP_DPI = 160

_converters: dict[str, object] = {}
_conv_lock = threading.Lock()


class FigureDescription(BaseModel):
    description: str
    labels: list[str]


class PageCheck(BaseModel):
    matches: bool
    problems: list[str]


FIGURE_SYSTEM = (
    "You caption technical figures (wiring diagrams, exploded views, schematics) from equipment manuals "
    "so technicians can find them by search. Describe what the figure shows: components, their printed "
    "labels, part numbers, pin or terminal numbers, and how they connect. Only report what is visible."
)

CHECK_SYSTEM = (
    "You check OCR output of scanned equipment manual pages before technicians rely on it. Compare the "
    "transcript with the page image. Report every number, code, part number, terminal, torque or other value "
    "that the transcript misreads or misses. Set matches to true only if there are none."
)


def converter(full_page_ocr: bool = False):
    """Docling converters load their models once per process."""
    key = "full" if full_page_ocr else "default"
    with _conv_lock:
        if key not in _converters:
            from docling.datamodel.base_models import InputFormat
            from docling.datamodel.pipeline_options import OcrMode, PdfPipelineOptions
            from docling.document_converter import DocumentConverter, PdfFormatOption

            from docling.datamodel.accelerator_options import AcceleratorOptions

            opts = PdfPipelineOptions(do_ocr=True, do_table_structure=True)
            opts.table_structure_options.do_cell_matching = True
            opts.accelerator_options = AcceleratorOptions(num_threads=os.cpu_count() or 4)
            if full_page_ocr:
                opts.ocr_options.mode = OcrMode.FULL_PAGE
                opts.images_scale = 2.0
            _converters[key] = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})
        return _converters[key]


def docling_version() -> str:
    try:
        return f"docling {pkg_version('docling')}"
    except Exception:
        return "docling"


def render_page(page: pymupdf.Page, path) -> None:
    page.get_pixmap(dpi=PAGE_DPI).save(path)


def crop_png(pdf_path: str, page_no: int, bbox: list[float], pad: float = 6) -> bytes:
    with pymupdf.open(pdf_path) as doc:
        page = doc[page_no - 1]
        r = pymupdf.Rect(bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad) & page.rect
        return page.get_pixmap(dpi=CROP_DPI, clip=r).tobytes("png")


def page_png(pdf_path: str, page_no: int, dpi: int = 150) -> bytes:
    with pymupdf.open(pdf_path) as doc:
        return doc[page_no - 1].get_pixmap(dpi=dpi).tobytes("png")


def _inside(inner, outer, tol: float = 3) -> bool:
    return (inner[0] >= outer[0] - tol and inner[1] >= outer[1] - tol
            and inner[2] <= outer[2] + tol and inner[3] <= outer[3] + tol)


def _union(a, b):
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def _sec_label(section: str) -> str:
    m = HEADING.match(section)
    return "§" + m.group(1) if m else ""


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("­", "")).strip()


def _margin_numbers(page: pymupdf.Page) -> list[int]:
    h = page.rect.height
    out: list[int] = []
    for b in page.get_text("blocks"):
        if b[1] < MARGIN_BAND or b[3] > h - MARGIN_BAND:
            out += [int(m) for m in re.findall(r"(?<!\d)(\d{1,4})(?!\d)", b[4])]
    return out


def page_label_offset(pdf, first: int, last: int) -> int:
    """Manuals print their own page numbers, which rarely match the PDF's.

    Read the running headers of the first pages and take the offset that keeps recurring,
    so a citation says "p. 377" exactly as the printed page does."""
    votes: dict[int, int] = {}
    for n in range(first, min(last, first + 11) + 1):
        for v in _margin_numbers(pdf[n - 1]):
            if 0 < v < 10000:
                votes[v - n] = votes.get(v - n, 0) + 1
    if not votes:
        return 0
    offset, count = max(votes.items(), key=lambda kv: (kv[1], -abs(kv[0])))
    return offset if count >= 3 else 0


def _table_rows(item, page_height: float) -> list[dict]:
    """Rows of a table with the box of each one, so a single row can be cited and outlined.

    Fault-code tables run for pages; the answer to "what is fault 2310" is one row of one."""
    rows: dict[int, dict] = {}
    header: dict[int, str] = {}
    for c in getattr(item.data, "table_cells", []) or []:
        text = _clean(c.text)
        if c.bbox is None:
            continue
        box = list(c.bbox.to_top_left_origin(page_height=page_height).as_tuple())
        if c.column_header:
            for col in range(c.start_col_offset_idx, c.end_col_offset_idx):
                header[col] = text
            continue
        row = rows.setdefault(c.start_row_offset_idx, {"cells": [], "bbox": box})
        row["cells"].append((c.start_col_offset_idx, text))
        row["bbox"] = _union(row["bbox"], box)
    out = []
    for idx in sorted(rows):
        ordered = sorted(rows[idx]["cells"])
        if any(t for _, t in ordered):
            out.append({"cells": [t for _, t in ordered], "columns": [header.get(i, "") for i, _ in ordered],
                        "bbox": rows[idx]["bbox"]})
    return out


def _items_by_page(doc) -> dict[int, list[dict]]:
    """Flatten Docling's document into per-page items with top-left-origin boxes, in reading order."""
    from docling_core.types.doc import DocItemLabel, ListItem, PictureItem, SectionHeaderItem, TableItem, TextItem

    pages: dict[int, list[dict]] = {}
    for item, _level in doc.iterate_items():
        if not getattr(item, "prov", None):
            continue
        prov = item.prov[0]
        height = doc.pages[prov.page_no].size.height
        bbox = list(prov.bbox.to_top_left_origin(page_height=height).as_tuple())
        label = item.label
        if label in (DocItemLabel.PAGE_HEADER, DocItemLabel.PAGE_FOOTER):
            continue
        entry = {"bbox": bbox, "ref": item.self_ref}
        if isinstance(item, TableItem):
            try:
                df = item.export_to_dataframe(doc=doc)
                header = [_clean(str(c)) for c in df.columns]
                body = [[_clean(str(v)) for v in row] for row in df.values.tolist()]
                rows = ([header] if any(h and not h.isdigit() for h in header) else []) + body
            except Exception:
                rows = []
            entry.update(kind="table", caption=_clean(item.caption_text(doc)), rows=[r for r in rows if any(r)],
                         cells=_table_rows(item, height))
        elif isinstance(item, PictureItem):
            entry.update(kind="figure", caption=_clean(item.caption_text(doc)))
        elif isinstance(item, SectionHeaderItem) or label == DocItemLabel.TITLE:
            entry.update(kind="heading", text=_clean(item.text))
        elif label == DocItemLabel.CAPTION:
            entry.update(kind="caption", text=_clean(item.text))
        elif isinstance(item, ListItem):
            text = _clean(item.text)
            marker = _clean(getattr(item, "marker", "") or "")
            if marker and not text.startswith(marker):
                text = f"{marker} {text}"
            entry.update(kind="list", text=text)
        elif isinstance(item, TextItem):
            entry.update(kind="text", text=_clean(item.text))
        else:
            continue
        if entry.get("text", "x") == "":
            continue
        pages.setdefault(prov.page_no, []).append(entry)
    return pages


def page_chunks(items: list[dict], section: str) -> tuple[list[dict], str]:
    """Group one page's items into chunks: warnings, text under headings, tables, figures."""
    chunks: list[dict] = []
    figures = [i for i in items if i["kind"] == "figure"]
    tables = [i for i in items if i["kind"] == "table"]
    captions = [i for i in items if i["kind"] == "caption"]
    used: set[int] = set()

    def nearest_caption(box, pattern, cap):
        if cap and pattern.match(cap):
            # Docling linked the caption; its caption item must not also become a text chunk.
            for c in captions:
                if c["text"] == cap:
                    used.add(id(c))
                    return cap, c
            return cap, None
        best = None
        for c in captions:
            if id(c) in used or not pattern.match(c["text"]):
                continue
            gap = min(abs(c["bbox"][1] - box[3]), abs(box[1] - c["bbox"][3]))
            if c["bbox"][0] < box[2] and c["bbox"][2] > box[0] and gap < 40 and (best is None or gap < best[0]):
                best = (gap, c)
        return (best[1]["text"], best[1]) if best else (cap, None)

    for t in tables:
        caption, c = nearest_caption(t["bbox"], TABLE_LABEL, t["caption"])
        box = _union(t["bbox"], c["bbox"]) if c else t["bbox"]
        if c:
            used.add(id(c))
        m = TABLE_LABEL.match(caption or "")
        label = "Table " + m.group(1).rstrip(".:") if m else ""
        body = "\n".join(" | ".join(r) for r in t["rows"])
        chunks.append({"kind": "table", "label": label, "text": f"{caption}\n{body}".strip(),
                       "bbox": box, "y": box[1]})
        # A long table is indexed row by row as well, so one row can be cited and outlined on its own.
        rows = t.get("cells") or []
        if len(rows) >= MIN_ROWS_TO_SPLIT:
            for row in rows:
                first = next((v for v in row["cells"] if v), "")
                pairs = [f"{col}: {val}" if col else val for col, val in zip(row["columns"], row["cells"]) if val]
                head = f"{caption} - {first}".strip(" -") if caption else first
                chunks.append({"kind": "table_row", "label": f"{label}, row {first}" if label else f"Row {first}",
                               "text": (head + "\n" + "\n".join(pairs)).strip(),
                               "bbox": row["bbox"], "y": row["bbox"][1]})
    for f in figures:
        caption, c = nearest_caption(f["bbox"], FIG_LABEL, f["caption"])
        box = _union(f["bbox"], c["bbox"]) if c else f["bbox"]
        if c:
            used.add(id(c))
        inner = [i for i in items if i["kind"] in ("text", "list", "heading") and _inside(i["bbox"], f["bbox"])]
        for i in inner:
            used.add(id(i))
        m = FIG_LABEL.match(caption or "")
        labels = " ".join(i["text"] for i in inner)
        chunks.append({"kind": "figure", "label": "Fig. " + m.group(1).rstrip(".:") if m else "",
                       "text": (caption + ("\nLabels in figure: " + labels if labels else "")).strip() or "Figure",
                       "bbox": box, "y": box[1]})

    out: list[dict] = []
    current: dict | None = None

    def flush():
        nonlocal current
        if current and current["text"].strip():
            out.append(current)
        current = None

    for i in items:
        if id(i) in used or i["kind"] in ("table", "figure") or any(_inside(i["bbox"], t["bbox"]) for t in tables):
            continue
        text = i["text"]
        if i["kind"] == "caption":
            i = {**i, "kind": "text"}
        if i["kind"] == "heading" or (HEADING.match(text) and len(text) < 90 and i["kind"] == "text"):
            flush()
            section = text
        if WARNING.match(text):
            flush()
            out.append({"kind": "warning", "section": section, "text": text, "bbox": i["bbox"], "y": i["bbox"][1]})
            continue
        is_list = i["kind"] == "list"
        if current and (current["list"] != is_list or len(current["text"]) + len(text) > MAX_CHUNK_CHARS):
            flush()
        if current is None:
            current = {"kind": "text", "section": section, "text": text, "bbox": i["bbox"], "y": i["bbox"][1], "list": is_list}
        else:
            current["text"] += "\n" + text
            current["bbox"] = _union(current["bbox"], i["bbox"])
    flush()

    # Tables and figures belong to the section of the text just above them.
    for c in chunks:
        before = [t for t in out if t["y"] <= c["y"]]
        c["section"] = before[-1]["section"] if before else section
    result = sorted(chunks + out, key=lambda c: c["y"])
    for c in result:
        c.pop("y", None)
        c.pop("list", None)
        c.setdefault("label", "")
        if c["kind"] in ("text", "warning"):
            c["label"] = _sec_label(c["section"])
    return result, section


def _ocr_scores(result) -> dict[int, float]:
    """Docling's per-page OCR confidence, where the installed version reports it."""
    out: dict[int, float] = {}
    try:
        for page_no, score in result.confidence.pages.items():
            s = getattr(score, "ocr_score", float("nan"))
            if s is not None and not math.isnan(s):
                out[int(page_no)] = float(s)
    except Exception:
        pass
    return out


def describe_figure(pdf_path: str, page_no: int, bbox, caption: str) -> str | None:
    try:
        png = crop_png(pdf_path, page_no, bbox)
        result, _ = llm.parse(FIGURE_SYSTEM,
                              [llm.image_block(png), {"type": "text", "text": f"Printed caption: {caption or '(none)'}"}],
                              FigureDescription, effort="low")
    except llm.LLMUnavailable as e:
        log.warning("figure caption skipped: %s", e)
        return None
    return result.description + ("\nLabels: " + ", ".join(result.labels) if result.labels else "")


def check_ocr_page(pdf_path: str, page_no: int, transcript: str) -> PageCheck | None:
    try:
        result, _ = llm.parse(CHECK_SYSTEM, [llm.image_block(page_png(pdf_path, page_no)),
                                             {"type": "text", "text": f"OCR transcript:\n{transcript}"}],
                              PageCheck, effort="medium")
        return result
    except llm.LLMUnavailable as e:
        log.warning("OCR page check skipped: %s", e)
        return None


def ingest_document(document_id: int) -> None:
    """Parse, verify, store, then index (Qdrant) and link (Neo4j). Runs in a background task."""
    with db.session() as conn:
        doc = db.row(conn.execute("SELECT * FROM documents WHERE id=%s", (document_id,)).fetchone())
    if doc is None:
        return
    pdf_path = str(config.FILES_DIR / doc["filename"])

    def fail(msg: str):
        log.error("ingest of document %s failed: %s", document_id, msg)
        with db.session() as conn:
            conn.execute("UPDATE documents SET status='failed', error=%s WHERE id=%s", (msg[:500], document_id))

    try:
        pdf = pymupdf.open(pdf_path)
    except Exception as e:
        return fail(f"Could not open PDF: {e}")
    # A long manual can be ingested one chapter at a time; page numbers stay the manual's own.
    first = max(1, doc["page_from"] or 1)
    last = min(len(pdf), doc["page_to"] or len(pdf))
    if last < first:
        pdf.close()
        return fail(f"Page range {first}-{last} is empty")
    try:
        result = converter().convert(pdf_path, page_range=(first, last))
        items = _items_by_page(result.document)
        scores = _ocr_scores(result)
    except Exception as e:
        pdf.close()
        return fail(f"Docling could not parse the document: {e}")

    use_llm = config.llm_enabled()
    (config.PAGES_DIR / str(document_id)).mkdir(parents=True, exist_ok=True)
    offset = page_label_offset(pdf, first, last)
    section = ""
    try:
        with db.session() as conn:
            conn.execute("DELETE FROM pages WHERE document_id=%s", (document_id,))
            for page_no in range(first, last + 1):
                page = pdf[page_no - 1]
                image = f"{document_id}/{page_no}.png"
                render_page(page, config.PAGES_DIR / image)
                w, h = page.rect.width, page.rect.height
                scanned = len(page.get_text().strip()) < 40
                chunks, section = page_chunks(items.get(page_no, []), section)

                if not scanned:
                    status, confidence, reason, extractor = "verified", 1.0, "", "docling"
                else:
                    extractor = "docling-ocr"
                    confidence = scores.get(page_no, 1.0 if chunks else 0.0)
                    if chunks and confidence < config.OCR_MIN_CONFIDENCE:
                        # Low confidence: retry this page once with full-page OCR at higher resolution.
                        try:
                            retry = converter(full_page_ocr=True).convert(pdf_path, page_range=(page_no, page_no))
                            r_items = _items_by_page(retry.document).get(page_no, [])
                            r_score = _ocr_scores(retry).get(page_no, confidence)
                            if r_items and r_score > confidence:
                                chunks, section = page_chunks(r_items, section)
                                confidence, extractor = r_score, "docling-ocr-retry"
                        except Exception as e:
                            log.warning("OCR retry failed on page %s: %s", page_no, e)
                    chunks = [c for c in chunks if c["text"] != "Figure"]  # an unreadable blob is not content
                    readable = sum(len(c["text"]) for c in chunks)
                    if readable < 20:
                        status, reason = "quarantined", "Scanned page: no text could be read reliably."
                    elif confidence < config.OCR_MIN_CONFIDENCE:
                        status, reason = "quarantined", f"Low OCR confidence ({confidence:.2f}) after retry."
                    else:
                        status, reason = "unverified", "Machine-read scan. Check the original before acting."
                        if use_llm:
                            check = check_ocr_page(pdf_path, page_no, "\n".join(c["text"] for c in chunks))
                            if check and not check.matches:
                                status = "quarantined"
                                reason = "Vision check found misread values: " + "; ".join(check.problems)[:400]
                if use_llm:
                    for c in chunks:
                        if c["kind"] == "figure":
                            desc = describe_figure(pdf_path, page_no, c["bbox"], c["text"])
                            if desc:
                                c["text"] += "\nDescription: " + desc
                                c["extractor"] = "docling+vlm-caption"

                page_id = conn.execute(
                    "INSERT INTO pages(document_id, page_no, label, width, height, image, status, confidence, extractor, reason)"
                    " VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                    (document_id, page_no, str(page_no + offset) if offset else "", w, h, image, status,
                     confidence, extractor, reason)).fetchone()["id"]
                for c in chunks:
                    conn.execute(
                        "INSERT INTO chunks(document_id, page_id, page_no, kind, section, label, text, bbox, extractor, confidence)"
                        " VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        (document_id, page_id, page_no, c["kind"], c["section"], c["label"], c["text"],
                         db.dumps([round(v, 1) for v in c["bbox"]]), c.get("extractor", extractor), confidence))
            conn.execute("UPDATE documents SET page_count=%s, extractor=%s WHERE id=%s",
                         (last - first + 1, docling_version(), document_id))
    except Exception as e:
        log.exception("ingest failed")
        return fail(str(e))
    finally:
        pdf.close()

    try:
        with db.session() as conn:
            index.index_document(conn, document_id)
            graph.index_document(conn, document_id)
            conn.execute("UPDATE documents SET status='ready', error='' WHERE id=%s", (document_id,))
    except Exception as e:
        log.exception("indexing failed")
        fail(f"Stored, but indexing failed: {e}")
