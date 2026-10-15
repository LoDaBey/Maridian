"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveSheetTemplate } from "@/app/(app)/sheets/actions";

export function SaveAsTemplateDialog({
  open,
  workbookId,
  suggestedName,
  onClose,
}: {
  open: boolean;
  workbookId: string;
  suggestedName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(suggestedName);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(suggestedName);
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, suggestedName]);

  if (!open) {
    return null;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await saveSheetTemplate({ workbookId, name });
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-labelledby="save-template-title"
        className="w-full max-w-md rounded-md border border-border bg-surface p-5 text-sm shadow-sm"
      >
        <h2 id="save-template-title" className="text-base font-semibold">
          Save as template
        </h2>
        <p className="mt-1 text-muted">
          Keeps the tabs and columns. Row values are not copied.
        </p>
        <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="save-template-name" className="font-medium">
              Template name
            </label>
            <input
              id="save-template-name"
              value={name}
              required
              maxLength={100}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              className="rounded-lg border border-border px-3 py-2 outline-none"
            />
          </div>
          {error ? (
            <p role="alert" className="text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              aria-label="Cancel save as template"
              className="cursor-pointer rounded-lg border border-border px-3 py-2"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              aria-label="Save as template"
              disabled={pending}
              className="cursor-pointer rounded-lg bg-primary px-3 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Saving..." : "Save template"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
