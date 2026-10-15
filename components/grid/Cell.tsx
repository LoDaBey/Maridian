"use client";

import { memo, useEffect, useRef } from "react";
import type { JsonValue } from "@/lib/sheets/ops";
import { MessageCircle } from "lucide-react";
import { isAutomaticColumnType, type ColumnType } from "@/lib/db-types";
import { dueToneFor, rowIsDone } from "@/lib/sheets/column-meta";
import { readFillColor, type StatusOption } from "@/lib/sheets/values";
import { useCell, useColumn, useRow, useSheetStore } from "@/stores/sheet-store";
import { AutoCellValue } from "./renderers/AutoCellValue";
import { FieldEditor } from "./editors/FieldEditor";
import { CellPresenceOverlay } from "@/components/presence/CellPresenceOverlay";
import { CellValue } from "./renderers/CellValue";
import type { DirectoryUser } from "./types";

const NAME_OPEN_DELAY_MS = 250;

function opensOnClick(type: ColumnType): boolean {
  return (
    type === "long_text" ||
    type === "link" ||
    type === "date" ||
    type === "due_date" ||
    type === "status" ||
    type === "priority" ||
    type === "dropdown" ||
    type === "person" ||
    type === "timeline" ||
    type === "tags" ||
    type === "country" ||
    type === "rating" ||
    type === "files"
  );
}

export const GridCell = memo(function GridCell({
  rowId,
  columnId,
  width,
  active,
  inRange,
  editing,
  seed,
  flash,
  readOnly,
  users,
  isNameColumn,
  updateCount,
  onSelect,
  onOpen,
  onOpenItem,
  onToggle,
  onCommit,
  onCancel,
  onInvalid,
  onAddOption,
  onOpenLink,
}: {
  rowId: string;
  columnId: string;
  width: number;
  active: boolean;
  inRange: boolean;
  editing: boolean;
  seed: string | null;
  flash: boolean;
  readOnly: boolean;
  users: DirectoryUser[];
  isNameColumn?: boolean;
  updateCount?: number;
  onSelect: (rowId: string, columnId: string, extend: boolean) => void;
  onOpen: (rowId: string, columnId: string) => void;
  onOpenItem?: (rowId: string) => void;
  onToggle: (rowId: string, columnId: string) => void;
  onCommit: (rowId: string, columnId: string, value: JsonValue | null, move: "down" | "next" | "none") => void;
  onCancel: () => void;
  onInvalid: (message: string) => void;
  onAddOption: (columnId: string, options: StatusOption[]) => void;
  onOpenLink: (url: string) => void;
}) {
  const value = useCell(rowId, columnId);
  const column = useColumn(columnId);
  const row = useRow(rowId);
  const nameOpenTimer = useRef<number>(0);

  useEffect(() => {
    return () => window.clearTimeout(nameOpenTimer.current);
  }, []);

  if (!column) {
    return null;
  }
  const automatic = isAutomaticColumnType(column.type);
  const locked = readOnly || automatic;
  const ownColor = column.type === "status" || column.type === "priority" || column.type === "dropdown";
  const fillColor = ownColor ? undefined : readFillColor(column.settings, "fillColor");
  const columns = useSheetStore().getState().columns;
  const done = row ? rowIsDone(row.data, Object.values(columns)) : false;
  const dueTone =
    column.type === "due_date" && typeof value === "string" ? dueToneFor(value, done) : null;

  const linkUrl =
    column.type === "link" && value && typeof value === "object" && !Array.isArray(value) && typeof value.url === "string"
      ? value.url
      : "";

  return (
    <div
      role="gridcell"
      aria-selected={active || inRange}
      data-row-id={rowId}
      data-column-id={columnId}
      data-active={active ? "true" : undefined}
      data-flash={flash ? "true" : undefined}
      className={`relative h-10 shrink-0 text-[13px] text-text ${inRange ? "bg-selection" : fillColor ? "" : "bg-transparent"} ${active ? "outline outline-2 -outline-offset-2 outline-primary" : ""} ${flash ? "[animation:presence-flash_0.6s_ease-in-out_2]" : ""}`}
      style={{ width, backgroundColor: inRange || !fillColor ? undefined : fillColor }}
      onMouseDown={(event) => {
        if (event.metaKey || event.ctrlKey) {
          if (linkUrl) {
            event.preventDefault();
            onOpenLink(linkUrl);
          }
          return;
        }
        onSelect(rowId, columnId, event.shiftKey);
        if (isNameColumn) {
          return;
        }
        if (!locked && !event.shiftKey && column.type === "checkbox") {
          onToggle(rowId, columnId);
          return;
        }
        if (!locked && !event.shiftKey && opensOnClick(column.type)) {
          onOpen(rowId, columnId);
        }
      }}
      onClick={(event) => {
        if (!isNameColumn || !onOpenItem || event.shiftKey || event.metaKey || event.ctrlKey) {
          return;
        }
        window.clearTimeout(nameOpenTimer.current);
        nameOpenTimer.current = window.setTimeout(() => {
          onOpenItem(rowId);
        }, NAME_OPEN_DELAY_MS);
      }}
      onDoubleClick={(event) => {
        if (isNameColumn) {
          event.preventDefault();
          window.clearTimeout(nameOpenTimer.current);
          if (!locked) {
            onOpen(rowId, columnId);
          }
          return;
        }
        if (!locked && column.type !== "checkbox") {
          onOpen(rowId, columnId);
        }
      }}
    >
      <CellPresenceOverlay rowId={rowId} columnId={columnId} editing={editing && !locked} />
      {editing && !locked ? (
        <FieldEditor
          column={column}
          value={value}
          seed={seed}
          users={users}
          onCommit={(next, move) => onCommit(rowId, columnId, next, move)}
          onCancel={onCancel}
          onInvalid={onInvalid}
          onAddOption={(options) => onAddOption(columnId, options)}
        />
      ) : (
        automatic && row ? (
          <AutoCellValue column={column} row={row} users={users} />
        ) : (
          <span className="flex h-full min-w-0 items-center">
            <span className="min-w-0 flex-1">
              <CellValue column={column} value={value} users={users} dueTone={dueTone} centered={!isNameColumn} />
            </span>
            {isNameColumn && (updateCount ?? 0) > 0 ? (
              <span className="me-1 inline-flex items-center gap-0.5 rounded-full bg-track px-1 text-[10px] text-muted">
                <MessageCircle className="size-3" aria-hidden="true" />
                {updateCount}
              </span>
            ) : null}
          </span>
        )
      )}
    </div>
  );
});

