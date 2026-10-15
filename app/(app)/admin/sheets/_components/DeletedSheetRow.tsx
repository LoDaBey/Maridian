"use client";

import type { DeletedWorkbookSummary } from "@/lib/db-types";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function DeletedSheetRow({
  workbook,
  pending,
  onPurge,
}: {
  workbook: DeletedWorkbookSummary;
  pending: boolean;
  onPurge: (id: string) => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-3">
      <div className="min-w-0">
        <p className="truncate font-medium">{workbook.name}</p>
        <p className="mt-1 text-xs text-muted">
          Deleted {formatDate(workbook.deletedAt)} by {workbook.deletedByName}. Owner: {workbook.createdByName}.
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {workbook.canPurge
            ? "Ready to delete for good."
            : `Can be deleted for good after ${formatDate(workbook.purgeAt)}.`}
        </p>
      </div>
      <button
        type="button"
        aria-label={`Delete ${workbook.name} for good`}
        disabled={pending || !workbook.canPurge}
        className="cursor-pointer rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => onPurge(workbook.id)}
      >
        {pending ? "Deleting..." : "Delete for good"}
      </button>
    </li>
  );
}
