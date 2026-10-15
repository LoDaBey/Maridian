"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { duplicateSheet } from "@/app/(app)/sheets/actions";

export function DuplicateSheetDialog({
  sourceId,
  sourceName,
  onClose,
}: {
  sourceId: string;
  sourceName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const suggested = `Copy of ${sourceName}`.slice(0, 100);
  const [name, setName] = useState(suggested);
  const [withRows, setWithRows] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await duplicateSheet({ id: sourceId, name, withRows });
      if (result.error || !result.id) {
        setError(result.error || "Could not duplicate the sheet.");
        return;
      }
      onClose();
      router.push(`/s/${result.id}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-labelledby="duplicate-sheet-title"
        className="w-full max-w-md rounded-md border border-border bg-surface p-5 text-sm shadow-sm"
      >
        <h2 id="duplicate-sheet-title" className="text-base font-semibold">
          Duplicate {sourceName}
        </h2>
        <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="duplicate-sheet-name" className="font-medium">
              Name
            </label>
            <input
              id="duplicate-sheet-name"
              value={name}
              required
              maxLength={100}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              className="rounded-md border border-border px-3 py-2 outline-none"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={withRows}
              onChange={(event) => setWithRows(event.target.checked)}
              className="outline-none"
            />
            Include rows
          </label>
          {error ? (
            <p role="alert" className="text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              aria-label="Cancel duplicate"
              className="cursor-pointer rounded-md border border-border px-3 py-2"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              aria-label={`Duplicate ${sourceName}`}
              disabled={pending}
              className="cursor-pointer rounded-md bg-primary px-3 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Duplicating..." : "Duplicate"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
