"use client";

import { useRef, useState } from "react";
import { normalizeValue } from "@/lib/sheets/values";
import type { JsonValue } from "@/lib/sheets/ops";
import type { LocalColumn } from "@/lib/sheets/apply-local";

export function LongTextEditor({
  column,
  value,
  seed,
  onCommit,
  onCancel,
  onInvalid,
}: {
  column: LocalColumn;
  value: JsonValue | undefined;
  seed: string | null;
  onCommit: (value: JsonValue | null, move: "down" | "next" | "none") => void;
  onCancel: () => void;
  onInvalid: (message: string) => void;
}) {
  const initial = seed ?? (typeof value === "string" ? value : "");
  const [draft, setDraft] = useState(initial);
  const done = useRef(false);

  function finish(next: string, move: "down" | "next" | "none"): void {
    if (done.current) {
      return;
    }
    const result = normalizeValue(column, next);
    if (!result.ok) {
      onInvalid(result.error);
      return;
    }
    done.current = true;
    onCommit(result.value ?? null, move);
  }

  return (
    <textarea
      autoFocus
      value={draft}
      aria-label={`Edit ${column.name}`}
      className="absolute start-0 top-full z-30 min-h-[140px] min-w-[240px] rounded border border-border bg-surface p-2 text-[13px] outline-none"
      onChange={(event) => setDraft(event.target.value)}
      onMouseDown={(event) => event.stopPropagation()}
      onBlur={() => finish(draft, "none")}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          finish(draft, "down");
        } else if (event.key === "Tab") {
          event.preventDefault();
          finish(draft, "next");
        } else if (event.key === "Escape") {
          event.preventDefault();
          done.current = true;
          onCancel();
        }
      }}
    />
  );
}
