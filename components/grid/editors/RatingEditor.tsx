"use client";

import { Star } from "lucide-react";
import type { JsonValue } from "@/lib/sheets/ops";
import type { LocalColumn } from "@/lib/sheets/apply-local";

export function RatingEditor({
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
  const current = typeof value === "number" ? value : 0;

  return (
    <div
      className="absolute start-0 top-full z-30 flex items-center gap-1 rounded-lg border border-border bg-surface p-2 shadow"
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      {[1, 2, 3, 4, 5].map((score) => (
        <button
          key={score}
          type="button"
          aria-label={`Rate ${column.name} ${score} of 5`}
          className="cursor-pointer rounded-lg p-0.5"
          onClick={() => onCommit(score, "none")}
        >
          <Star className={`size-4 ${score <= current ? "fill-amber-400 text-amber-400" : "text-muted"}`} aria-hidden="true" />
        </button>
      ))}
      <button
        type="button"
        aria-label="Clear rating"
        className="cursor-pointer rounded-lg px-2 py-1 text-xs text-muted"
        onClick={() => onCommit(null, "none")}
      >
        Clear
      </button>
    </div>
  );
}
