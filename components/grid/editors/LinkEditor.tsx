"use client";

import { useRef, useState } from "react";
import { normalizeValue } from "@/lib/sheets/values";
import type { JsonValue } from "@/lib/sheets/ops";
import type { LocalColumn } from "@/lib/sheets/apply-local";

export function LinkEditor({
  column,
  value,
  onCommit,
  onCancel,
  onInvalid,
}: {
  column: LocalColumn;
  value: JsonValue | undefined;
  onCommit: (value: JsonValue | null, move: "down" | "next" | "none") => void;
  onCancel: () => void;
  onInvalid: (message: string) => void;
}) {
  const current = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const [url, setUrl] = useState(current && typeof current.url === "string" ? current.url : "");
  const [label, setLabel] = useState(current && typeof current.label === "string" ? current.label : "");
  const done = useRef(false);

  function finish(move: "down" | "next" | "none"): void {
    if (done.current) {
      return;
    }
    const raw = url.trim() ? { url, label: label.trim() || undefined } : null;
    const result = normalizeValue(column, raw);
    if (!result.ok) {
      onInvalid(result.error);
      return;
    }
    done.current = true;
    onCommit(result.value ?? null, move);
  }

  return (
    <div
      className="absolute start-0 top-full z-30 flex w-64 flex-col gap-2 rounded-lg border border-border bg-surface p-2 shadow"
      onMouseDown={(event) => event.stopPropagation()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          finish("none");
        }
      }}
    >
      <input
        autoFocus
        value={url}
        aria-label={`URL for ${column.name}`}
        placeholder="https://"
        className="rounded border border-border px-2 py-1 text-[13px] outline-none"
        onChange={(event) => setUrl(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish("down");
          } else if (event.key === "Escape") {
            event.preventDefault();
            done.current = true;
            onCancel();
          }
        }}
      />
      <input
        value={label}
        aria-label={`Label for ${column.name}`}
        placeholder="Label"
        className="rounded border border-border px-2 py-1 text-[13px] outline-none"
        onChange={(event) => setLabel(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish("down");
          } else if (event.key === "Escape") {
            event.preventDefault();
            done.current = true;
            onCancel();
          }
        }}
      />
    </div>
  );
}
