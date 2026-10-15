"use client";

import { createPortal } from "react-dom";
import { useSyncExternalStore } from "react";
import { ROLE_LABEL } from "@/lib/rbac";
import { followPresence, usePresencePeople, type PresencePerson } from "@/stores/presence-store";
import { useColumns, useRowIds } from "@/stores/sheet-store";

export function AvatarStack() {
  const people = usePresencePeople();
  const rowIds = useRowIds();
  const columns = useColumns();
  const slot = usePresenceSlot();
  if (!slot || people.length === 0) {
    return null;
  }

  const shown = people.slice(0, 5);
  const extra = people.length - shown.length;

  return createPortal(
    <div className="flex items-center gap-1">
      {shown.map((person) => {
        const place = location(person, rowIds, columns);
        const label = `${person.fullName}${person.you ? " (you)" : ""} · ${ROLE_LABEL[person.role]}${place ? ` · ${place}` : ""}`;
        return (
          <button
            key={person.userId}
            type="button"
            data-presence-user={person.userId}
            data-presence-you={person.you ? "true" : "false"}
            data-presence-idle={person.idle ? "true" : "false"}
            aria-label={person.you ? `Follow you, ${person.fullName}` : `Follow ${person.fullName}`}
            title={label}
            className={`inline-flex size-7 cursor-pointer items-center justify-center rounded-full text-[10px] font-medium text-white ${person.idle ? "opacity-40" : ""}`}
            style={{ backgroundColor: person.avatarColor }}
            onClick={() => {
              if (person.activeCell) {
                followPresence(person.activeCell.rowId, person.activeCell.columnId);
              }
            }}
          >
            {initials(person.fullName)}
          </button>
        );
      })}
      {extra > 0 ? <span className="text-xs text-muted">+{extra}</span> : null}
    </div>,
    slot,
  );
}

function usePresenceSlot(): HTMLElement | null {
  return useSyncExternalStore(
    () => () => {},
    () => document.getElementById("presence-slot"),
    () => null,
  );
}

function location(
  person: PresencePerson,
  rowIds: string[],
  columns: Array<{ id: string; name: string }>,
): string {
  if (person.editing) {
    return "typing…";
  }
  if (!person.activeCell) {
    return "";
  }
  const row = rowIds.indexOf(person.activeCell.rowId);
  const column = columns.find((item) => item.id === person.activeCell?.columnId);
  if (row < 0 || !column) {
    return "";
  }
  return `Row ${row + 1} · ${column.name}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0] ?? "").join("").toUpperCase() || "?";
}
