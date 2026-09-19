import { Library } from "@/components/Library";

type Tab = "documents" | "review" | "machines";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const t: Tab = tab === "review" || tab === "machines" ? tab : "documents";
  return <Library tab={t} />;
}
