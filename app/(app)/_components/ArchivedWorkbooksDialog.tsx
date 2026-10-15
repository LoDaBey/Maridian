"use client";

import { useEffect, useState } from "react";
import { restoreWorkbook } from "@/app/(app)/sheets/actions";
import type { WorkbookSummary } from "@/lib/sheets/sheets-repo";

export function ArchivedWorkbooksDialog({
  workbooks,
  onClose,
}: {
  workbooks: WorkbookSummary[];
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function onRestore(id: string) {
    setPendingId(id);
    setError("");
    try {
      const result = await restoreWorkbook({ id });
      if (result.error) {
        setError(result.error);
      }
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-labelledby="archived-workbooks-title"
        className="flex max-h-[70vh] w-full max-w-md flex-col rounded-md border border-border bg-surface p-5 text-sm shadow-sm"
      >
        <h2 id="archived-workbooks-title" className="text-base font-semibold">
          Archived sheets
        </h2>
        {error ? (
          <p role="alert" className="mt-3 text-danger">
            {error}
          </p>
        ) : null}
        <ul className="mt-4 flex flex-col gap-2 overflow-y-auto">
          {workbooks.length === 0 ? (
            <li className="text-muted">No archived sheets.</li>
          ) : (
            workbooks.map((workbook) => (
              <li
                key={workbook.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <span className="min-w-0 truncate">{workbook.name}</span>
                <button
                  type="button"
                  aria-label={`Restore ${workbook.name}`}
                  disabled={pendingId === workbook.id}
                  className="cursor-pointer rounded-md border border-border px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => {
                    void onRestore(workbook.id);
                  }}
                >
                  Restore
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            aria-label="Close archived sheets"
            className="cursor-pointer rounded-md border border-border px-3 py-2"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
