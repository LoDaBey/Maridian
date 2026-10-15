"use client";

import type { JsonValue } from "@/lib/sheets/ops";
import type { LocalColumn } from "@/lib/sheets/apply-local";

export function DateEditor({
  column,
  value,
  onCommit,
  onCancel,
}: {
  column: LocalColumn;
  value: JsonValue | undefined;
  onCommit: (value: JsonValue | null, move: "down" | "next" | "none") => void;
  onCancel: () => void;
}) {
  const current = typeof value === "string" ? value : "";

  return (
    <div
      className="absolute start-0 top-full z-30 flex w-56 flex-col gap-2 rounded-lg border border-border bg-surface p-2 shadow"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <input
        autoFocus
        type="date"
        aria-label={`Date for ${column.name}`}
        defaultValue={current}
        className="rounded border border-border px-2 py-1 text-[13px] outline-none"
        onChange={(event) => {
          if (event.target.value) {
            onCommit(event.target.value, "none");
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex gap-2">
        <button
          type="button"
          aria-label="Choose today"
          className="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs"
          onClick={() => onCommit(todayIso(), "none")}
        >
          Today
        </button>
        <button
          type="button"
          aria-label="Clear date"
          className="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs"
          onClick={() => onCommit(null, "none")}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
