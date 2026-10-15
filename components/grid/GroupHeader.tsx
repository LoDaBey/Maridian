"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, GripVertical, MoreHorizontal } from "lucide-react";

export function GroupHeader({
  groupId,
  name,
  color,
  count,
  collapsed,
  width,
  canEdit,
  canReorder,
  onToggle,
  onRename,
  onOpenMenu,
  onDragStart,
}: {
  groupId: string;
  name: string;
  color: string;
  count: number;
  collapsed: boolean;
  width: number;
  canEdit: boolean;
  canReorder: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onOpenMenu: (x: number, y: number) => void;
  onDragStart: (groupId: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(name);
  }, [name]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commit(): void {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== name) {
      onRename(next);
    } else {
      setDraft(name);
    }
  }

  return (
    <div
      data-group-id={groupId}
      className="flex h-8 items-center gap-1 bg-surface px-1"
      style={{ width }}
    >
      {canReorder ? (
        <button
          type="button"
          aria-label={`Reorder ${name}`}
          className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-row"
          onPointerDown={(event) => onDragStart(groupId, event)}
        >
          <GripVertical className="size-3.5" aria-hidden="true" />
        </button>
      ) : (
        <span className="size-7" />
      )}
      <button
        type="button"
        aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
        aria-expanded={!collapsed}
        className="flex size-7 cursor-pointer items-center justify-center rounded-lg hover:bg-row"
        style={{ color }}
        onClick={onToggle}
      >
        <ChevronDown className={`size-4 transition ${collapsed ? "-rotate-90" : ""}`} aria-hidden="true" />
      </button>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          aria-label="Group name"
          className="h-7 min-w-0 flex-1 rounded outline-none"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              setDraft(name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          aria-label={`Rename ${name}`}
          className="min-w-0 cursor-pointer truncate rounded-lg px-1 text-start text-base font-medium"
          style={{ color }}
          onClick={() => {
            if (canEdit) {
              setEditing(true);
            }
          }}
        >
          {name}
        </button>
      )}
      <span className="text-xs text-muted">{count}</span>
      <div className="flex-1" />
      {canEdit ? (
        <button
          type="button"
          aria-label={`Group options for ${name}`}
          className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-row"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onOpenMenu(rect.left, rect.bottom);
          }}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
