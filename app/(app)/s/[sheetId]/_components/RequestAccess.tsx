"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { requestSheetAccess } from "../actions";

/** Shown when a sheet doesn't exist or isn't shared with you. */
export function RequestAccess() {
  const pathname = usePathname();
  const sheetId = pathname.split("/")[2] ?? "";
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error: string; message: string } | null>(null);

  async function send() {
    setBusy(true);
    setResult(await requestSheetAccess({ sheetId, note }));
    setBusy(false);
  }

  return (
    <main className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
        <Lock className="mx-auto mb-3 size-8 text-muted" aria-hidden="true" />
        <h1 className="text-xl font-semibold">You can&apos;t open this sheet</h1>
        <p className="mt-1 text-sm text-muted">It may have been deleted, or it hasn&apos;t been shared with you yet.</p>
        {result && !result.error ? (
          <p role="status" className="mt-4 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            {result.message}
          </p>
        ) : (
          <>
            <textarea
              value={note}
              rows={2}
              maxLength={300}
              dir="auto"
              aria-label="Note for the sheet owner"
              placeholder="Add a note for the owner (optional)"
              className="mt-4 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              onChange={(event) => setNote(event.target.value)}
            />
            {result?.error ? (
              <p role="alert" className="mt-1 text-sm text-danger">
                {result.error}
              </p>
            ) : null}
            <button
              type="button"
              disabled={busy || !sheetId}
              className="mt-3 w-full cursor-pointer rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
              onClick={() => void send()}
            >
              {busy ? "Sending…" : "Request access"}
            </button>
          </>
        )}
        <Link href="/" className="mt-3 inline-block text-sm text-primary hover:underline">
          Back to my sheets
        </Link>
      </div>
    </main>
  );
}
