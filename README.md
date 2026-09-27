# Foreman

A plant-floor troubleshooting assistant. A technician scans a machine's QR tag, says or photographs the fault, and gets a warning-first procedure where every step cites the manual page, table or figure it came from. If a step does not match the machine, Foreman searches again or hands it to the document owner. It never guesses.

```
foreman/
  docker-compose.yml   PostgreSQL, Qdrant, Neo4j
  backend/             FastAPI: Docling ingest, verification, hybrid search, answers, claim check, escalations
  frontend/            Next.js: technician view, library, escalations inbox, answer history
  landing/             Marketing site (separate Vite project)
```

## Stack

| Layer | Technology | Role |
|---|---|---|
| API | **FastAPI** | Ingest, search, answer, correction loop, escalations |
| Parsing | **Docling** | Layout detection, OCR (RapidOCR) and table structure; every element keeps its page and bounding box |
| Vision-language model | **Claude** (`claude-opus-5`) | Reads technicians' photos, captions figures, **reads wiring diagrams into a netlist**, cross-checks OCR'd pages, drafts and audits answers |
| System of record | **PostgreSQL** | Documents and versions, pages, chunks with page/bbox/extractor/confidence, assets and QR tags, answer logs, flags, fix notes |
| Index | **Qdrant** | Dense embeddings + BM25 sparse vectors + an exact-identifier sparse vector, fused in one query (RRF); FastEmbed runs the models locally |
| Graph | **Neo4j** | Asset → Document → Procedure → FaultCode / Component / Part, plus fix notes, for multi-hop retrieval |
| Reranker | FastEmbed cross-encoder (`ms-marco-MiniLM-L-6-v2`) | Orders candidates and drops off-topic ones |
| Frontend | **Next.js** (App Router) + Tailwind | Phone-first technician view and desktop tools; proxies `/api` to FastAPI |

PostgreSQL is the system of record. Qdrant and Neo4j are rebuilt from it with `python -m app.rebuild`.

## Run it

Needs Docker, Python 3.11+ and Node 20+.

```bash
# 1. Data stores
docker compose up -d                 # Postgres on :5433, Qdrant on :6333, Neo4j on :7474/:7687

# 2. Backend
cd backend
python -m venv .venv
.venv/Scripts/activate               # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt      # includes Docling and PyTorch (CPU): a large download
cp .env.example .env                 # optional: add ANTHROPIC_API_KEY
uvicorn app.main:app --port 8000

# 3. Frontend
cd ../frontend
npm install
npm run dev                          # http://localhost:3001   (production: npm run build && npm start)
```

On first start the backend builds a demo library in the background: a 48-page CV-12 conveyor drive manual, a 2023 service bulletin, a pump manual, and a two-page scanned addendum. Docling reads it in about 5 minutes on a laptop CPU, and the Library page shows progress. The first run also downloads the Docling, OCR, embedding and reranker models.

To reset the demo, run `python -m app.sample --reset`. It clears all three stores.

### Loading real manuals

Drop PDFs in a folder and import them in one command, rather than uploading one at a time:

```bash
cd backend
python -m app.import_folder ../manuals --asset ACS580 --owner "Drives engineering"
python -m app.import_folder ../manuals --manifest ../manuals/manifest.json   # per-manual settings
python -m app.import_folder ../manuals --manifest ../manuals/manifest.json --dry-run
```

The manifest gives each manual its own machine, owner and **page range**, which matters: Docling reads a
few seconds per page, so a 460-page manual is hours while its fault-tracing chapter is minutes. Files already
imported are skipped, so the command can be re-run as the folder grows. See `manuals/manifest.json`.

Manufacturers publish these manuals for download (ABB, Siemens, Rockwell, Danfoss, Grundfos, SKF and others).
Keep them out of the repo: `manuals/*.pdf` and `backend/data/` are git-ignored.

## Scanning a machine tag with a phone

The QR label on a machine encodes `<address>/ask?asset=CV-12`, so a technician can scan it either with
Foreman's **Scan tag** button or with the phone's own camera app. Both open Foreman on that machine.

Set the address the labels use under **Library → Machines & tags → Address printed on the labels**, then
download each label. It is stored per browser, so labels stay valid even when printed from localhost.

**Browsers only allow the camera (and the microphone, for voice) on HTTPS or localhost.** Over
`http://<laptop-ip>:3001` the in-app scanner will say so and offer manual tag entry. Two ways to get HTTPS:

```bash
# A quick public HTTPS address (no account, changes on every restart)
cloudflared tunnel --url http://localhost:3001

# Or serve the app itself over HTTPS on your network with a local certificate
npm run dev -- --experimental-https      # Android: tap through the warning; iOS: trust the certificate first
```

Open the HTTPS address on the phone, set it as the label address, and print the labels from there.

In-app scanning uses the browser's `BarcodeDetector` where it exists (Chrome, Edge) and falls back to jsQR
(Safari, Firefox), so it works on any phone.


### Technician mode and engineer mode

Every answer is the same grounded answer; the switch above the question box decides how much of the
reasoning behind it is put on screen.

| | Technician | Engineer / research |
|---|---|---|
| For | The person standing at the faulted machine | Reliability, controls and document owners |
| The answer | Warnings first, action steps, nothing else | The same warnings and cited steps, with what the evidence shows and where it is thin |
| Below the answer | - | **Why this answer?**: identifiers matched exactly, graph links that brought evidence in, page verification status, pages carried from an earlier turn, and the top evidence with its reranker score |
| Needs a model | No | No - without a key the panel still reports the retrieval on record |

The panel is built from the retrieval metadata Foreman already logs for every answer. It is a receipt for
how the evidence was chosen, not the model's account of its own reasoning.

### With or without a model

| | No API key (extractive mode) | `ANTHROPIC_API_KEY` set |
|---|---|---|
| Answers | Steps quoted verbatim from the best-matching procedure | Claude drafts steps from the evidence, including page crops of figures and tables |
| Claim check | Not needed: every step is source text | Each claim is checked against its cited passage; unsupported ones are dropped and listed |
| Photos | Stored with the question and the flag | Read for fault codes, labels and part numbers, then used in search |
| Scanned pages | Docling OCR; unverified or quarantined by OCR score | Same, plus a vision check of the transcript against the page image |
| Figures | Caption and printed labels | Also described by the vision model, so they are searchable |
| Wiring diagrams | Caption and printed labels only | Read into a netlist: terminals, devices and what connects to what, as graph nodes |
| Correction loop | Revises when a procedure names what the technician reported | Rewrites the rest of the procedure from new evidence |

If a model call fails (network, rate limit), that request falls back to extractive mode.

## Demo script (3 minutes)

1. **Troubleshoot → CV-12.** Ask "Conveyor stopped, HMI shows E-42". The lock-out warning comes first, then 7 steps citing §4.2.3, Fig. 12 and Table 4-3 on page 47. Tap **Fig. 12, p. 47**: the page opens with the relay figure outlined.
2. **Ask a follow-up** instead of repeating yourself: "and what is the torque spec?" The machine, the earlier steps and the pages they rest on are carried forward, so the answer is the torque table on the same page, cited - not the whole procedure again. **New question** leaves the conversation.
3. **Not what I see** on step 2: "There is no K3, that slot says SPARE, the relay is K4." Neo4j finds the procedure that involves both K3 and K4 (Service Bulletin SB-2023-04, filed under another conveyor). Steps 2–4 are rewritten for relay K4 with citations to the bulletin, and the old K3 steps are dropped.
4. **Not what I see** on the torque step: "Terminals are push-in spring type X9Q." Nothing covers it, so the procedure pauses and escalates to Reliability engineering, with a call button.
5. **Escalations.** The owner reads the note and the cited page, and publishes a fix note. It's written to Postgres, indexed in Qdrant and linked in Neo4j.
6. **Troubleshoot** again with "E-42, relay has X9Q push-in terminals". The fix note is now a cited source.
7. **Ask** "What does terminal X4:7 carry?" The answer comes from the OCR'd addendum and shows **Unverified page: check the original**.
8. **Library → Review queue.** Addendum page 2 is too faded to read, so it's quarantined and can't be cited until approved. **Machines & tags** prints the QR label that opens `/ask?asset=CV-12`.
9. **Engineer mode.** Flip the switch above the question box and ask the same E-42 question. The procedure is the same and still cited; underneath, **Why this answer?** shows the identifier that matched (E-42), the graph links that pulled in the bulletin, each page's verification status, and the top evidence with its reranker score.
10. **History.** Each answer shows what was retrieved: reranker score, exact code matches, and which graph links brought each chunk in.
11. Ask something that isn't covered ("recalibrate the laser height scanner"). The answer is "Not in the documents".

## How a question becomes a cited answer

The pipeline has five stages, as in the deck.

1. **Ingest** (`app/ingest.py`). Docling parses layout, lists, tables and figures, and runs OCR on scans. Items become chunks under their section heading, each with page, bounding box, extractor and confidence. PyMuPDF renders page images for the evidence viewer.
   - **Long tables are also indexed row by row.** A fault-code table runs for pages, and the answer to "what is fault 2310" is one row of it, so each row is its own citation with its own box: the evidence viewer outlines that row alone.
   - **A long manual can be ingested a chapter at a time** (page range on upload), which keeps ingest to minutes instead of an hour.
   - **Citations use the page number printed on the page.** Manuals rarely start at PDF page 1; the offset is read from the running headers, so a chip says "p. 377" exactly as the page does.
   - **Wiring diagrams are read, not just captioned** (`app/schematic.py`). A figure that talks like a circuit is sent to the vision model a second time and comes back as a netlist: devices, terminals and the wires between them. The netlist becomes a `schematic` chunk with the figure's box, so it is searched, cited and outlined like any other evidence, and its terminals become nodes in the graph. Nothing is inferred from what the circuit "should" be: a line the model cannot follow is listed as unreadable instead of completed.
2. **Verify.** Pages with a text layer are *verified*. OCR'd pages are *unverified* (citable, with a warning) when the Docling OCR score is at least 0.85. A low score is retried once with full-page OCR at 2× resolution, then quarantined. With a model, a vision check can also quarantine a page it finds misread. Owners approve or reject pages in the review queue, and Qdrant's payload is updated at once.
3. **Find** (`app/search.py`).
   - Qdrant runs dense, BM25 and exact-identifier retrieval in one fused query, filtered to the machine's documents and to citable pages.
   - Neo4j adds the chunks of procedures linked to the fault codes, components, parts and terminals in the question, and the drawings that show those terminals - including the drawing of the far end of a wire, which is what answers "what does X4:7 land on".
   - A cross-encoder reranks the candidates. Exact code matches and graph links add to the score, and off-topic candidates are dropped.
4. **Answer** (`app/answer.py`). Structured output: warnings and steps, each with the chunk IDs it rests on.
   A follow-up ("and what is the torque spec?") continues the same thread through `queries.parent_id`: the
   machine, the earlier turns and the pages those turns cited are carried into the next search and put back
   in front of the model. Carrying the conversation changes what is searched, never whether a step has to be
   supported - a follow-up is claim-checked exactly like a first answer.
5. **Prove.** Each claim is checked against its cited passages. Unsupported claims are removed. Confidence is *verified source*, *unverified page* or *not in the documents*.

Every answer is logged in PostgreSQL with the question, retrieved chunks and their scores, model, final text and removed claims.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/ask` | form: `asset`, `question`, optional `photo`, `follow_up_to`, `mode` (`technician` default, or `engineer`) → cited answer |
| POST | `/api/queries/{id}/flag` | form: `step_index`, `note`, optional `photo` → `revised` or `escalated` |
| GET | `/api/flags?status=open` | escalations inbox |
| POST | `/api/flags/{id}/fixnote` | `{author, text}` → fix note becomes a source |
| POST | `/api/documents` | multipart PDF upload + `title`, `version`, `owner`, `owner_contact`, `assets` |
| GET | `/api/documents/{id}` | pages, statuses, extracted regions |
| GET | `/api/review` · POST `/api/pages/{id}/review` | review queue, `{action: approve|reject}` |
| GET/POST | `/api/assets` | machines and QR tags |
| GET | `/api/queries`, `/api/queries/{id}` | answer history |
| GET | `/api/health`, `/api/stats` | service status; rows, points and nodes per store |

Interactive docs: http://localhost:8000/docs

## Tests

The tests need the Docker services running. They use their own database (`foreman_test`), Qdrant collection and Neo4j namespace, and a shortened 9-page manual.

```bash
cd backend
pytest
```
