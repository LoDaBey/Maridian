"use client";

import { useState } from "react";
import { useStore } from "zustand";
import { CellHistoryPopover } from "@/components/history/CellHistoryPopover";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { can, canDeleteRow } from "@/lib/rbac";
import { useSheetStore } from "@/stores/sheet-store";
import { useMe } from "./MeContext";

export function RowContextMenu({
  menu,
  targets,
  onClose,
  onInsert,
  onDuplicate,
  onDelete,
}: {
  menu: { rowId: string; x: number; y: number } | null;
  targets: string[];
  onClose: () => void;
  onInsert: (rowId: string, where: "above" | "below") => void;
  onDuplicate: (rowId: string) => void;
  onDelete: (rowIds: string[]) => void;
}) {
  const store = useSheetStore();
  const sheetId = useStore(store, (state) => state.sheet.id);
  const archived = useStore(store, (state) => state.archived);
  const me = useMe();
  const [history, setHistory] = useState<{ rowId: string; columnId: string; x: number; y: number } | null>(null);
  const columnId = menu ? columnUnderPointer(menu.x, menu.y, menu.rowId) : null;
  const allowed = targets.length > 0 && targets.every((rowId) => canDeleteRow(me, { created_by: store.getState().rows[rowId]?.createdBy ?? null }));

  if (!menu && !history) {
    return null;
  }

  const count = targets.length;
  const canRestore = can(me.role, "cell.edit") && !archived;

  return (
    <>
    {menu ? (
    <Menu open x={menu.x} y={menu.y} label={`Row actions for row ${menu.rowId}`} onClose={onClose}>
      <MenuItem
        label="Insert above"
        onSelect={() => {
          onInsert(menu.rowId, "above");
          onClose();
        }}
      />
      <MenuItem
        label="Insert below"
        onSelect={() => {
          onInsert(menu.rowId, "below");
          onClose();
        }}
      />
      <MenuItem
        label="Duplicate"
        onSelect={() => {
          onDuplicate(menu.rowId);
          onClose();
        }}
      />
      <MenuItem
        label={count > 1 ? `Delete ${count} rows` : "Delete row"}
        danger
        disabled={!allowed}
        title={allowed ? undefined : "You can only delete rows you created."}
        onSelect={() => {
          onDelete(targets);
          onClose();
        }}
      />
      <MenuItem
        label="Cell history"
        disabled={!columnId}
        title={columnId ? undefined : "Right-click a cell to see its history."}
        onSelect={() => {
          if (!columnId || !menu) {
            return;
          }
          setHistory({ rowId: menu.rowId, columnId, x: menu.x, y: menu.y });
          onClose();
        }}
      />
    </Menu>
    ) : null}
    {history ? (
      <CellHistoryPopover
        sheetId={sheetId}
        rowId={history.rowId}
        columnId={history.columnId}
        x={history.x}
        y={history.y}
        canRestore={canRestore}
        onClose={() => setHistory(null)}
      />
    ) : null}
    </>
  );
}

function columnUnderPointer(x: number, y: number, rowId: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const stacked = document.elementsFromPoint(x, y);
  for (const node of stacked) {
    if (!(node instanceof Element)) {
      continue;
    }
    const columnId = node.closest("[data-column-id]")?.getAttribute("data-column-id");
    const pointedRow = node.closest("[data-row-id]")?.getAttribute("data-row-id");
    if (columnId && (!pointedRow || pointedRow === rowId)) {
      return columnId;
    }
  }
  return document.querySelector(`[data-row-id="${CSS.escape(rowId)}"][data-active="true"]`)?.getAttribute("data-column-id") ?? null;
}
