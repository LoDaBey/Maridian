"use client";

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="flex h-full flex-col items-start gap-3 p-8">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted">{error.digest ? `Reference ${error.digest}` : "This page could not be loaded."}</p>
      <button type="button" aria-label="Retry" className="cursor-pointer rounded-lg bg-primary px-3 py-2 text-sm text-white" onClick={() => retry()}>
        Retry
      </button>
    </main>
  );
}
