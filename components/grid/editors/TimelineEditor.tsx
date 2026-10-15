"use client";

import type { JsonValue } from "@/lib/sheets/ops";
import type { LocalColumn } from "@/lib/sheets/apply-local";
import { asTimeline } from "@/lib/sheets/column-meta";

export function TimelineEditor({
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
  const range = asTimeline(value);

  function commit(start: string, end: string): void {
    if (!start && !end) {
      onCommit(null, "none");
      return;
    }
    if (!start || !end) {
      return;
    }
    onCommit(start <= end ? { start, end } : { start: end, end: start }, "none");
  }

  return (
    <div
      className="absolute start-0 top-full z-30 flex w-64 flex-col gap-2 rounded-lg border border-border bg-surface p-2 shadow"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <label className="text-xs text-muted">
        Start
        <input
          autoFocus
          type="date"
          aria-label={`Start date for ${column.name}`}
          defaultValue={range?.start ?? ""}
          className="mt-1 w-full rounded border border-border px-2 py-1 text-[13px] outline-none"
          onChange={(event) => commit(event.target.value, range?.end ?? event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
      </label>
      <label className="text-xs text-muted">
        End
        <input
          type="date"
          aria-label={`End date for ${column.name}`}
          defaultValue={range?.end ?? ""}
          className="mt-1 w-full rounded border border-border px-2 py-1 text-[13px] outline-none"
          onChange={(event) => commit(range?.start ?? event.target.value, event.target.value)}
        />
      </label>
      <button
        type="button"
        aria-label="Clear timeline"
        className="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs"
        onClick={() => onCommit(null, "none")}
      >
        Clear
      </button>
    </div>
  );
}
