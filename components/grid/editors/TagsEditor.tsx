"use client";

import { useState } from "react";
import type { JsonValue } from "@/lib/sheets/ops";
import type { LocalColumn } from "@/lib/sheets/apply-local";
import { asStringList, tagColorFor } from "@/lib/sheets/column-meta";

export function TagsEditor({
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
  const [draft, setDraft] = useState("");
  const tags = asStringList(value);

  function add(label: string): void {
    const next = label.trim();
    if (!next || tags.some((tag) => tag.toLowerCase() === next.toLowerCase())) {
      setDraft("");
      return;
    }
    onCommit([...tags, next], "none");
    setDraft("");
  }

  return (
    <div
      className="absolute start-0 top-full z-30 w-64 rounded-lg border border-border bg-surface p-2 shadow"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex flex-wrap gap-1">
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            aria-label={`Remove tag ${tag}`}
            className="cursor-pointer rounded-lg px-1.5 py-0.5 text-xs"
            style={{ backgroundColor: tagColorFor(tag) }}
            onClick={() => onCommit(tags.filter((item) => item !== tag), "none")}
          >
            {tag} ×
          </button>
        ))}
      </div>
      <input
        autoFocus
        value={draft}
        aria-label={`Add tag to ${column.name}`}
        placeholder="New tag"
        className="w-full rounded border border-border px-2 py-1 text-[13px] outline-none"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          if (event.key === "Enter") {
            event.preventDefault();
            add(draft);
          }
        }}
      />
    </div>
  );
}
