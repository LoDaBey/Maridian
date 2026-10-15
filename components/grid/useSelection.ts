"use client";

import { useState } from "react";
import type { GridSelection, SelectionBounds } from "./types";

export function selectionBounds(
  selection: GridSelection | null,
  rowIds: string[],
  columnIds: string[],
): SelectionBounds | null {
  if (!selection || rowIds.length === 0 || columnIds.length === 0) {
    return null;
  }
  const anchorRow = rowIds.indexOf(selection.anchor.rowId);
  const focusRow = rowIds.indexOf(selection.focus.rowId);
  const anchorCol = columnIds.indexOf(selection.anchor.columnId);
  const focusCol = columnIds.indexOf(selection.focus.columnId);
  if (anchorRow < 0 || focusRow < 0 || anchorCol < 0 || focusCol < 0) {
    return null;
  }
  return {
    rowStart: Math.min(anchorRow, focusRow),
    rowEnd: Math.max(anchorRow, focusRow),
    colStart: Math.min(anchorCol, focusCol),
    colEnd: Math.max(anchorCol, focusCol),
  };
}

export function useSelection(rowIds: string[], columnIds: string[]) {
  const [selection, setSelection] = useState<GridSelection | null>(null);

  function selectCell(rowId: string, columnId: string, extend: boolean): void {
    setSelection((current) => {
      if (extend && current) {
        return { anchor: current.anchor, focus: { rowId, columnId }, kind: "cell" };
      }
      return { anchor: { rowId, columnId }, focus: { rowId, columnId }, kind: "cell" };
    });
  }

  function selectRow(rowId: string, extend: boolean): void {
    const first = columnIds[0];
    const last = columnIds[columnIds.length - 1];
    if (!first || !last) {
      return;
    }
    setSelection((current) => {
      if (extend && current) {
        return { anchor: current.anchor, focus: { rowId, columnId: last }, kind: "row" };
      }
      return { anchor: { rowId, columnId: first }, focus: { rowId, columnId: last }, kind: "row" };
    });
  }

  function selectColumn(columnId: string, extend: boolean): void {
    const first = rowIds[0];
    const last = rowIds[rowIds.length - 1];
    if (!first || !last) {
      return;
    }
    setSelection((current) => {
      if (extend && current) {
        return { anchor: current.anchor, focus: { rowId: last, columnId }, kind: "column" };
      }
      return { anchor: { rowId: first, columnId }, focus: { rowId: last, columnId }, kind: "column" };
    });
  }

  function move(rowDelta: number, columnDelta: number, extend: boolean): void {
    setSelection((current) => {
      if (!current) {
        const rowId = rowIds[0];
        const columnId = columnIds[0];
        if (!rowId || !columnId) {
          return current;
        }
        return { anchor: { rowId, columnId }, focus: { rowId, columnId }, kind: "cell" };
      }
      const focus = current.focus;
      const rowIndex = rowIds.indexOf(focus.rowId);
      const columnIndex = columnIds.indexOf(focus.columnId);
      const nextRow = rowIds[clamp(rowIndex + rowDelta, 0, rowIds.length - 1)];
      const nextColumn = columnIds[clamp(columnIndex + columnDelta, 0, columnIds.length - 1)];
      if (!nextRow || !nextColumn) {
        return current;
      }
      const next = { rowId: nextRow, columnId: nextColumn };
      if (extend && current) {
        return { anchor: current.anchor, focus: next, kind: current.kind };
      }
      return { anchor: next, focus: next, kind: "cell" };
    });
  }

  function moveTab(backward: boolean): void {
    setSelection((current) => {
      if (!current || columnIds.length === 0 || rowIds.length === 0) {
        return current;
      }
      let rowIndex = rowIds.indexOf(current.focus.rowId);
      let columnIndex = columnIds.indexOf(current.focus.columnId);
      if (rowIndex < 0) {
        rowIndex = 0;
      }
      if (columnIndex < 0) {
        columnIndex = 0;
      }
      if (backward) {
        columnIndex -= 1;
        if (columnIndex < 0) {
          columnIndex = columnIds.length - 1;
          rowIndex = Math.max(0, rowIndex - 1);
        }
      } else {
        columnIndex += 1;
        if (columnIndex >= columnIds.length) {
          columnIndex = 0;
          rowIndex = Math.min(rowIds.length - 1, rowIndex + 1);
        }
      }
      const rowId = rowIds[rowIndex];
      const columnId = columnIds[columnIndex];
      if (!rowId || !columnId) {
        return current;
      }
      const next = { rowId, columnId };
      return { anchor: next, focus: next, kind: "cell" };
    });
  }

  return { selection, setSelection, selectCell, selectRow, selectColumn, move, moveTab };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
