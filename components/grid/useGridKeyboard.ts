"use client";

import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { SheetDirection } from "@/lib/db-types";

export function useGridKeyboard({
  direction,
  readOnly,
  editing,
  onMove,
  onTab,
  onEdit,
  onClear,
  onCopy,
  onUndo,
  onRedo,
  onToggleCheckbox,
  onFind,
}: {
  direction: SheetDirection;
  readOnly: boolean;
  editing: boolean;
  onMove: (rowDelta: number, columnDelta: number, extend: boolean) => void;
  onTab: (backward: boolean) => void;
  onEdit: (seed: string | null) => void;
  onClear: () => void;
  onCopy: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleCheckbox: () => void;
  onFind?: () => void;
}): (event: ReactKeyboardEvent<HTMLElement>) => void {
  return useCallback(
    (event) => {
      if (editing || event.target !== event.currentTarget) {
        return;
      }
      const key = event.key;
      const command = event.metaKey || event.ctrlKey;
      if (command && key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          onRedo();
        } else {
          onUndo();
        }
        return;
      }
      if (command && key.toLowerCase() === "y") {
        event.preventDefault();
        onRedo();
        return;
      }
      if (command && (key.toLowerCase() === "f" || key.toLowerCase() === "h") && onFind) {
        event.preventDefault();
        onFind();
        return;
      }
      if (command && key.toLowerCase() === "c") {
        event.preventDefault();
        onCopy();
        return;
      }
      if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") {
        event.preventDefault();
        if (key === "ArrowUp" || key === "ArrowDown") {
          onMove(key === "ArrowUp" ? -1 : 1, 0, event.shiftKey);
          return;
        }
        const towardVisualLeft = key === "ArrowLeft";
        const delta = direction === "rtl" ? (towardVisualLeft ? 1 : -1) : towardVisualLeft ? -1 : 1;
        onMove(0, delta, event.shiftKey);
        return;
      }
      if (key === "Tab") {
        event.preventDefault();
        onTab(event.shiftKey);
        return;
      }
      if (readOnly) {
        return;
      }
      if (key === "Enter" || key === "F2") {
        event.preventDefault();
        onEdit(null);
        return;
      }
      if (key === "Delete" || key === "Backspace") {
        event.preventDefault();
        onClear();
        return;
      }
      if (key === " " && !command && !event.altKey) {
        event.preventDefault();
        onToggleCheckbox();
        return;
      }
      if (key.length === 1 && !command && !event.altKey) {
        event.preventDefault();
        onEdit(key);
      }
    },
    [direction, editing, onClear, onCopy, onEdit, onMove, onRedo, onTab, onToggleCheckbox, onUndo, readOnly, onFind],
  );
}
