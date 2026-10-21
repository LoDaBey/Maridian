"use client";

import { useEffect, useRef, useState } from "react";
import { isAutomaticColumnType } from "@/lib/db-types";
import type { JsonValue } from "@/lib/sheets/ops";
import type { LocalColumn, LocalRow } from "@/lib/sheets/apply-local";
import { FieldEditor } from "@/components/grid/editors/FieldEditor";
import { TextEditor } from "@/components/grid/editors/TextEditor";
import { AutoCellValue } from "@/components/grid/renderers/AutoCellValue";
import { useCellLocked } from "@/components/grid/ProtectionContext";
import { CellValue } from "@/components/grid/renderers/CellValue";
import type { DirectoryUser } from "@/components/grid/types";
import { dueToneFor, rowIsDone } from "@/lib/sheets/column-meta";
import type { StatusOption } from "@/lib/sheets/values";
import { useSheetStore } from "@/stores/sheet-store";

export function ItemFieldRow({
  column,
  row,
  users,
  readOnly,
  onCommit,
  onInvalid,
  onAddOption,
}: {
  column: LocalColumn;
  row: LocalRow;
  users: DirectoryUser[];
  readOnly: boolean;
  onCommit: (columnId: string, value: JsonValue | null) => void;
  onInvalid: (message: string) => void;
  onAddOption: (columnId: string, options: StatusOption[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const automatic = isAutomaticColumnType(column.type);
  const protectedCell = useCellLocked(column.id, row.groupId);
  const locked = readOnly || automatic || protectedCell;
  const value = row.data[column.id];
  const inline = column.type === "text" || column.type === "number";
  const columns = useSheetStore().getState().columns;
  const dueTone =
    column.type === "due_date" && typeof value === "string"
      ? dueToneFor(value, rowIsDone(row.data, Object.values(columns)))
      : null;

  useEffect(() => {
    if (!editing) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setEditing(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setEditing(false);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [editing]);

  function commit(next: JsonValue | null): void {
    onCommit(column.id, next);
    setEditing(false);
  }

  function open(): void {
    if (locked) {
      return;
    }
    if (column.type === "checkbox") {
      onCommit(column.id, value === true ? false : true);
      return;
    }
    setEditing(true);
  }

  return (
    <div ref={rootRef} className="relative">
      <p className="mb-1 text-xs font-medium text-muted">{column.name}</p>
      {editing && inline ? (
        <div className="h-9 overflow-hidden rounded-lg border border-border bg-surface">
          <TextEditor
            column={column}
            value={value}
            seed={null}
            alignEnd={column.type === "number"}
            onCommit={(next) => commit(next)}
            onCancel={() => setEditing(false)}
            onInvalid={onInvalid}
          />
        </div>
      ) : (
        <div
          role={locked ? undefined : "button"}
          tabIndex={locked ? undefined : 0}
          aria-label={locked ? column.name : `Edit ${column.name}`}
          className={`relative flex min-h-9 w-full items-stretch overflow-hidden rounded-lg border border-border bg-surface text-start ${locked ? "" : "cursor-pointer hover:border-primary/40"}`}
          onClick={open}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              open();
            }
          }}
        >
          <span className="relative min-h-9 min-w-0 flex-1">
            {automatic ? (
              <AutoCellValue column={column} row={row} users={users} />
            ) : hasValue(column, value) ? (
              <CellValue column={column} value={value} users={users} dueTone={dueTone} />
            ) : (
              <span className="block px-2 leading-9 text-muted">Empty</span>
            )}
          </span>
        </div>
      )}
      {editing && !locked && !inline ? (
        <FieldEditor
          column={column}
          value={value}
          users={users}
          onCommit={(next) => commit(next)}
          onCancel={() => setEditing(false)}
          onInvalid={onInvalid}
          onAddOption={(options) => onAddOption(column.id, options)}
        />
      ) : null}
    </div>
  );
}

function hasValue(column: LocalColumn, value: JsonValue | undefined): boolean {
  if (value === undefined || value === null || value === "") {
    return false;
  }
  if (column.type === "checkbox") {
    return true;
  }
  if (column.type === "person" || column.type === "tags" || column.type === "dropdown" || column.type === "files") {
    return Array.isArray(value) && value.length > 0;
  }
  return true;
}
