import Link from "next/link";

export default function AppNotFound() {
  return (
    <main className="flex h-full flex-col items-start gap-3 p-8">
      <h1 className="text-xl font-semibold">Sheet not found</h1>
      <p className="text-sm text-muted">That sheet is missing, or you cannot open it.</p>
      <Link href="/" className="cursor-pointer rounded-lg bg-primary px-3 py-2 text-sm text-white" aria-label="Back to sheets">
        Back to sheets
      </Link>
    </main>
  );
}
