"use client";

import { useRef, useState } from "react";
import type { JsonValue } from "@/lib/sheets/ops";
import { normalizeValue } from "@/lib/sheets/values";
import type { LocalColumn } from "@/lib/sheets/apply-local";

export function TextEditor({
  column,
  value,
  seed,
  alignEnd = false,
  centered = false,
  onCommit,
  onCancel,
  onInvalid,
}: {
  column: LocalColumn;
  value: JsonValue | undefined;
  seed: string | null;
  alignEnd?: boolean;
  centered?: boolean;
  onCommit: (value: JsonValue | null, move: "down" | "next" | "none") => void;
  onCancel: () => void;
  onInvalid: (message: string) => void;
}) {
  const initial = seed ?? (typeof value === "string" || typeof value === "number" ? String(value) : "");
  const [draft, setDraft] = useState(initial);
  const [shake, setShake] = useState(false);
  const done = useRef(false);

  function finish(next: string, move: "down" | "next" | "none"): void {
    if (done.current) {
      return;
    }
    const parsed = column.type === "number" ? normalizeValue(column, next.trim() ? Number(next) : null) : normalizeValue(column, next);
    const result = column.type === "number" && next.trim() && !parsed.ok ? normalizeValue(column, next.trim()) : parsed;
    if (!result.ok) {
      setShake(true);
      onInvalid(result.error);
      return;
    }
    done.current = true;
    onCommit(result.value ?? null, move);
  }

  return (
    <>
      <style>{`@keyframes grid-shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }`}</style>
      <input
        autoFocus
        value={draft}
        aria-label={`Edit ${column.name}`}
        inputMode={column.type === "number" ? "decimal" : "text"}
        dir="auto"
        className={`h-full w-full rounded bg-surface px-2 text-[13px] outline-none ${alignEnd ? "text-end" : centered ? "text-center" : "text-start"} ${shake ? "[animation:grid-shake_0.3s_linear]" : ""}`}
        onChange={(event) => setDraft(event.target.value)}
        onMouseDown={(event) => event.stopPropagation()}
        onBlur={() => finish(draft, "none")}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
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
    </>
  );
}
