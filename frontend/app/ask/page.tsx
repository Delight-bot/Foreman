import { Ask } from "@/components/Ask";

// A QR tag on the machine opens /ask?asset=CV-12.
export default async function AskPage({ searchParams }: { searchParams: Promise<{ asset?: string; q?: string }> }) {
  const { asset, q } = await searchParams;
  return <Ask key={`${asset ?? ""}:${q ?? ""}`} tag={asset ?? null} queryId={q ? Number(q) : null} />;
}
