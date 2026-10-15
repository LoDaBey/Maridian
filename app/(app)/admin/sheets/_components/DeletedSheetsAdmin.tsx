"use client";

import { useState } from "react";
import { purgeWorkbook } from "@/app/(app)/sheets/actions";
import type { DeletedWorkbookSummary } from "@/lib/db-types";
import { DeletedSheetRow } from "./DeletedSheetRow";

export function DeletedSheetsAdmin({ workbooks }: { workbooks: DeletedWorkbookSummary[] }) {
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function onPurge(id: string) {
    setPendingId(id);
    setError("");
    try {
      const result = await purgeWorkbook({ id });
      if (result.error) {
        setError(result.error);
      }
    } finally {
      setPendingId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-text">Deleted sheets</h1>
      <p className="mt-1 text-sm text-muted">
        Soft-deleted sheets stay here for 30 days. After that they can be deleted for good.
      </p>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ul className="mt-6 flex flex-col gap-3">
        {workbooks.length === 0 ? (
          <li className="text-sm text-muted">No deleted sheets.</li>
        ) : (
          workbooks.map((workbook) => (
            <DeletedSheetRow
              key={workbook.id}
              workbook={workbook}
              pending={pendingId === workbook.id}
              onPurge={(id) => {
                void onPurge(id);
              }}
            />
          ))
        )}
      </ul>
    </main>
  );
}
