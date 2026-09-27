export type PageStatus = "verified" | "unverified" | "quarantined" | "rejected";
/** Who an answer is written for. Distinct from `Answer.mode`, which is how it was produced. */
export type Audience = "technician" | "engineer";
export type Confidence = "verified" | "unverified" | "not_found";

export interface Asset {
  id: number;
  tag: string;
  name: string;
  location: string;
  documents?: { id: number; title: string; version: string; owner?: string }[];
  open_flags?: number;
  recent?: { id: number; question: string; confidence: Confidence; created_at: string }[];
}

export interface Citation {
  chunk_id: number;
  kind: "text" | "warning" | "table" | "table_row" | "figure" | "fixnote";
  label: string;
  section?: string;
  text: string;
  status: PageStatus;
  status_reason?: string;
  extractor: string;
  author?: string;
  created_at?: string;
  document: { id: number; title: string; version: string; owner: string; owner_contact: string } | null;
  page_no: number | null;
  page_label?: string; // the number printed on the page, which often differs from the PDF's
  page_id?: number;
  bbox: [number, number, number, number] | null;
  page_size: [number, number] | null;
  image_url: string | null;
}

export interface Claim {
  text: string;
  chunk_ids: number[];
}

export interface Flag {
  id: number;
  query_id: number;
  step_index: number;
  step_text: string;
  note: string;
  photo: string | null;
  photo_url?: string | null;
  outcome: "revised" | "escalated";
  revised_query_id: number | null;
  owner: string;
  owner_contact: string;
  status: "open" | "resolved";
  fix_chunk_id: number | null;
  created_at: string;
  resolved_at: string | null;
  question?: string;
  asset_tag?: string;
  asset_name?: string;
  asset_location?: string;
  citations?: (Citation | null)[];
  fix_note?: Citation;
}

export interface Answer {
  id: number;
  question: string;
  asset: Asset | null;
  photo_url: string | null;
  confidence: Confidence;
  mode: "model" | "extractive";
  model: string;
  parent_id: number | null;
  created_at: string;
  understanding: { observation?: string; search_terms?: string[]; codes?: string[] };
  retrieved: {
    chunk_id: number;
    score: number;
    label: string;
    page_no: number | null;
    kind: string;
    rerank?: number | null; // cross-encoder relevance
    codes?: string[]; // identifiers matched exactly
    graph?: string[]; // fault codes / components / parts the asset graph linked it through
    carried?: boolean; // cited by an earlier turn of this conversation
    status?: PageStatus; // verification status of the page it came from
  }[];
  warnings: Claim[];
  steps: Claim[];
  gap: string;
  closest: number | null;
  dropped: { text: string; reason: string }[];
  revised_indices?: number[];
  revised_reason?: string;
  follow_up_to?: number; // set when this answer continues an earlier one
  audience: Audience; // technician (default) or engineer

  citations: Record<string, Citation>;
  flags: Flag[];
}

export interface FlagResult {
  outcome: "revised" | "escalated";
  flag: Flag;
  revised: Answer | null;
  tried: { chunk_id: number; label: string; page_no: number | null }[];
}

export interface Chunk {
  id: number;
  page_id: number;
  kind: Citation["kind"];
  label: string;
  section: string;
  text: string;
  bbox: [number, number, number, number] | null;
  extractor: string;
  confidence: number;
}

export interface Page {
  id: number;
  document_id: number;
  page_no: number;
  width: number;
  height: number;
  status: PageStatus;
  confidence: number;
  extractor: string;
  reason: string;
  image_url: string;
  chunks: Chunk[];
  title?: string;
  version?: string;
  owner?: string;
}

export interface Doc {
  id: number;
  title: string;
  version: string;
  owner: string;
  owner_contact: string;
  page_count: number;
  status: "processing" | "ready" | "failed";
  error: string;
  extractor: string;
  page_from: number | null;
  page_to: number | null;
  created_at: string;
  pages_by_status: Partial<Record<PageStatus, number>>;
  assets: string[];
  chunks: number;
  pages?: Page[];
}

export interface QueryRow {
  id: number;
  question: string;
  confidence: Confidence;
  mode: string;
  model: string;
  parent_id: number | null;
  created_at: string;
  asset_tag: string | null;
  flags: number;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "Cannot reach the Foreman server. Check the connection and try again.");
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  health: () => request<{ ok: boolean; llm: boolean; model: string | null; services: Record<string, boolean> }>("/api/health"),
  assets: () => request<Asset[]>("/api/assets"),
  asset: (tag: string) => request<Asset>(`/api/assets/${encodeURIComponent(tag)}`),
  createAsset: (a: { tag: string; name: string; location: string }) => request<Asset>("/api/assets", json(a)),

  /** `followUpTo` continues an earlier answer: same machine, its evidence still in play.
   *  `mode` is who the answer is for; the server defaults to the technician. */
  ask: (asset: string, question: string, photo?: Blob | null, followUpTo?: number | null, mode?: Audience) => {
    const f = new FormData();
    f.set("asset", asset);
    f.set("question", question);
    if (photo) f.set("photo", photo, "photo.jpg");
    if (followUpTo != null) f.set("follow_up_to", String(followUpTo));
    if (mode) f.set("mode", mode);
    return request<Answer>("/api/ask", { method: "POST", body: f });
  },
  query: (id: number) => request<Answer>(`/api/queries/${id}`),
  queries: () => request<QueryRow[]>("/api/queries?limit=100"),
  flag: (queryId: number, stepIndex: number, note: string, photo?: Blob | null) => {
    const f = new FormData();
    f.set("step_index", String(stepIndex));
    f.set("note", note);
    if (photo) f.set("photo", photo, "photo.jpg");
    return request<FlagResult>(`/api/queries/${queryId}/flag`, { method: "POST", body: f });
  },

  flags: (status?: string) => request<Flag[]>(`/api/flags${status ? `?status=${status}` : ""}`),
  fixNote: (flagId: number, author: string, text: string) =>
    request<Flag>(`/api/flags/${flagId}/fixnote`, json({ author, text })),

  documents: () => request<Doc[]>("/api/documents"),
  document: (id: number) => request<Doc>(`/api/documents/${id}`),
  upload: (
    file: File,
    meta: { title: string; version: string; owner: string; owner_contact: string; assets: string[]; page_from?: string; page_to?: string },
  ) => {
    const f = new FormData();
    f.set("file", file);
    f.set("title", meta.title);
    f.set("version", meta.version);
    f.set("owner", meta.owner);
    f.set("owner_contact", meta.owner_contact);
    f.set("assets", meta.assets.join(","));
    if (meta.page_from) f.set("page_from", meta.page_from);
    if (meta.page_to) f.set("page_to", meta.page_to);
    return request<Doc>("/api/documents", { method: "POST", body: f });
  },
  deleteDocument: (id: number) => request<{ ok: boolean }>(`/api/documents/${id}`, { method: "DELETE" }),
  setDocumentAssets: (id: number, tags: string[]) =>
    request<{ ok: boolean }>(`/api/documents/${id}/assets`, { ...json(tags), method: "PUT" }),
  review: () => request<Page[]>("/api/review"),
  reviewPage: (pageId: number, action: "approve" | "reject", reviewer: string) =>
    request<{ ok: boolean; status: PageStatus }>(`/api/pages/${pageId}/review`, json({ action, reviewer })),
};
