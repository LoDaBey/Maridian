"use client";

import { useEffect, useState } from "react";

export function ItemTitle({
  value,
  fallback,
  readOnly,
  onCommit,
}: {
  value: string;
  fallback: string;
  readOnly: boolean;
  onCommit: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [value, editing]);

  if (readOnly || !editing) {
    return (
      <button
        type="button"
        aria-label={readOnly ? fallback : "Edit item name"}
        className={`min-w-0 flex-1 truncate text-start text-base font-semibold ${readOnly ? "" : "cursor-pointer rounded-lg px-1 py-0.5 hover:bg-gray-100"}`}
        onClick={() => {
          if (!readOnly) {
            setEditing(true);
          }
        }}
      >
        {value.trim() || fallback}
      </button>
    );
  }

  return (
    <input
      aria-label="Item name"
      autoFocus
      value={draft}
      maxLength={500}
      className="min-w-0 flex-1 rounded-lg border border-border px-2 py-1 text-base font-semibold outline-none"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim();
        setEditing(false);
        if (next !== value.trim()) {
          onCommit(next || null);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}
