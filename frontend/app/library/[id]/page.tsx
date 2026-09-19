import { DocDetail } from "@/components/Library";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-[1180px] px-4 py-6 md:px-6 lg:py-10">
      <DocDetail id={Number(id)} />
    </div>
  );
}
