"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { GripVertical, MoreVertical, Trash2 } from "lucide-react";
import { PresenceDot } from "@/components/presence/PresenceDot";
import { usePresenceOnRow } from "@/stores/presence-store";

export function RowGutter({
  rowId,
  number,
  selected,
  canReorder,
  dragging,
  showMenu,
  onSelect,
  onDragStart,
  onOpenMenu,
  canDelete,
  onDelete,
}: {
  rowId: string;
  number: number;
  selected: boolean;
  canReorder: boolean;
  dragging: boolean;
  showMenu: boolean;
  onSelect: (extend: boolean) => void;
  onDragStart: (rowId: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onOpenMenu: (rowId: string, x: number, y: number) => void;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const dots = usePresenceOnRow(rowId);

  return (
    <div
      data-row-id={rowId}
      className={`group sticky start-0 z-10 flex h-10 w-12 shrink-0 items-center bg-transparent text-[11px] text-muted ${selected ? "bg-selection" : ""}`}
    >
      {canReorder ? (
        <button
          type="button"
          aria-label={`Reorder row ${number}`}
          aria-grabbed={dragging}
          className={`absolute start-0 top-0 z-10 flex h-full w-3 cursor-grab items-center justify-center rounded-lg text-muted ${dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
          onPointerDown={(event) => onDragStart(rowId, event)}
        >
          <GripVertical className="size-3" aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={`Select row ${number}`}
        className="h-full w-full cursor-pointer text-center opacity-0 group-hover:opacity-100 focus:opacity-100"
        onMouseDown={(event) => {
          event.preventDefault();
          onSelect(event.shiftKey);
        }}
        onContextMenu={(event) => {
          if (!showMenu) {
            return;
          }
          event.preventDefault();
          onOpenMenu(rowId, event.clientX, event.clientY);
        }}
      >
        {number}
      </button>
      {selected && canDelete ? (
        <button
          type="button"
          aria-label={`Delete row ${number}`}
          className="absolute end-0 top-1 z-10 cursor-pointer rounded-lg p-0.5 text-danger"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="size-3" aria-hidden="true" />
        </button>
      ) : showMenu ? (
        <button
          type="button"
          aria-label={`Row actions for row ${number}`}
          aria-haspopup="menu"
          className="absolute end-0 top-1 z-10 cursor-pointer rounded-lg p-0.5 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            onOpenMenu(rowId, rect.left, rect.bottom);
          }}
        >
          <MoreVertical className="size-3" aria-hidden="true" />
        </button>
      ) : null}
      <PresenceDot colors={dots.colors} extra={dots.extra} />
    </div>
  );
}
