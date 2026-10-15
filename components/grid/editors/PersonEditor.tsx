"use client";

import { useEffect, useState } from "react";
import type { DirectoryUser } from "@/lib/db-types";
import type { JsonValue } from "@/lib/sheets/ops";
import type { LocalColumn } from "@/lib/sheets/apply-local";
import { refreshDirectory } from "../useDirectory";

export function PersonEditor({
  column,
  value,
  users,
  onCommit,
  onCancel,
}: {
  column: LocalColumn;
  value: JsonValue | undefined;
  users: DirectoryUser[];
  onCommit: (value: JsonValue | null, move: "down" | "next" | "none") => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const multiple = column.settings.multiple === true;
  const selected = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const needle = query.trim().toLowerCase();
  const visible = users.filter((user) => {
    if (!needle) {
      return true;
    }
    return (
      user.fullName.toLowerCase().includes(needle) ||
      (user.email ?? "").toLowerCase().includes(needle)
    );
  });

  useEffect(() => {
    refreshDirectory();
  }, []);

  function toggle(id: string): void {
    const has = selected.includes(id);
    const next = multiple ? (has ? selected.filter((item) => item !== id) : [...selected, id]) : has ? [] : [id];
    onCommit(next.length ? next : null, "none");
  }

  return (
    <div
      className="absolute start-0 top-full z-30 w-72 rounded-lg border border-border bg-surface p-2 shadow"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <input
        autoFocus
        value={query}
        aria-label={`Search people for ${column.name}`}
        placeholder="Search people"
        className="mb-2 w-full rounded border border-border px-2 py-1 text-[13px] outline-none"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="max-h-72 overflow-auto">
        {visible.length === 0 ? (
          <p className="px-2 py-2 text-[13px] text-muted">No people match.</p>
        ) : (
          visible.map((user) => {
            const on = selected.includes(user.id);
            return (
              <button
                key={user.id}
                type="button"
                aria-label={`${on ? "Remove" : "Assign"} ${user.fullName}`}
                aria-pressed={on}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-start ${on ? "bg-primary/10" : ""} ${user.isActive ? "" : "opacity-60"}`}
                onClick={() => toggle(user.id)}
              >
                <span
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] text-white"
                  style={{ backgroundColor: user.avatarColor }}
                >
                  {(user.fullName[0] ?? "?").toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{user.fullName}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {user.email}
                    {user.isActive ? "" : " · Inactive"}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
