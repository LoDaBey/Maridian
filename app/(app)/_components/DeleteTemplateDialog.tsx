"use client";

import { useEffect, useState } from "react";
import { deleteSheetTemplate } from "@/app/(app)/sheets/actions";

export function DeleteTemplateDialog({
  open,
  templateId,
  templateName,
  onClose,
}: {
  open: boolean;
  templateId: string;
  templateName: string;
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
      const result = await deleteSheetTemplate({ id: templateId });
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
        aria-labelledby="delete-template-title"
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 text-sm shadow-xl"
      >
        <h2 id="delete-template-title" className="text-base font-semibold">
          Delete {templateName}
        </h2>
        <p className="mt-2 text-muted">
          This permanently removes the template. Existing sheets made from it are not affected.
        </p>
        {error ? (
          <p role="alert" className="mt-3 text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            aria-label="Cancel delete template"
            disabled={pending}
            className="cursor-pointer rounded-lg px-3 py-1.5 outline-none disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            aria-label={`Delete ${templateName}`}
            disabled={pending}
            className="cursor-pointer rounded-lg bg-danger px-3 py-1.5 text-white outline-none disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void onConfirm()}
          >
            {pending ? "Deleting..." : "Delete template"}
          </button>
        </div>
      </div>
    </div>
  );
}
