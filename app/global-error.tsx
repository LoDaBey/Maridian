"use client";

export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", margin: "2rem" }}>
        <h1>Something went wrong</h1>
        <button type="button" aria-label="Retry" onClick={() => retry()} style={{ cursor: "pointer", borderRadius: "0.5rem", padding: "0.5rem 0.75rem" }}>
          Retry
        </button>
      </body>
    </html>
  );
}
