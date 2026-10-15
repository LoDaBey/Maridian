"use client";

import { useEffect, useState } from "react";
import { deleteWorkbook } from "@/app/(app)/sheets/actions";
import { WORKBOOK_PURGE_DAYS } from "@/lib/db-types";

export function DeleteWorkbookDialog({
  open,
  workbookId,
  workbookName,
  onClose,
}: {
  open: boolean;
  workbookId: string;
  workbookName: string;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setError("");
      setPending(false);
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, pending]);

  if (!open) {
    return null;
  }

  async function onConfirm() {
    setPending(true);
    setError("");
    try {
      const result = await deleteWorkbook({ id: workbookId });
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-labelledby="delete-workbook-title"
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 text-sm shadow-xl"
      >
        <h2 id="delete-workbook-title" className="text-base font-semibold">
          Delete {workbookName}
        </h2>
        <p className="mt-2 text-muted">
          This removes the sheet from your sheets. An admin can delete it for good after {WORKBOOK_PURGE_DAYS} days.
        </p>
        {error ? (
          <p role="alert" className="mt-3 text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            aria-label="Cancel delete sheet"
            disabled={pending}
            className="cursor-pointer rounded-lg px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            aria-label={`Delete ${workbookName}`}
            disabled={pending}
            className="cursor-pointer rounded-lg bg-danger px-3 py-1.5 text-white disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void onConfirm()}
          >
            {pending ? "Deleting..." : "Delete sheet"}
          </button>
        </div>
      </div>
    </div>
  );
}
