"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { columnSizingFeature, coreFeatures, useTable } from "@tanstack/react-table";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { useStore } from "zustand";
import { useSheetDispatch } from "@/lib/realtime/sheet-session";
import { canDeleteRow } from "@/lib/rbac";
import { applyOpToState } from "@/lib/sheets/apply-local";
import type { JsonValue, SheetOp } from "@/lib/sheets/ops";
import { visibleRowIds } from "./board-views";
import { useProtection } from "./ProtectionContext";
import { ProtectDialog } from "./ProtectDialog";
import { ChartView } from "./ChartView";
import { KanbanBoard } from "./KanbanBoard";
import { TimelineView } from "./TimelineView";
import { Toolbar } from "./Toolbar";
import { useBoardLayout } from "./useBoardLayout";
import { useViewState } from "./useViewState";
import { ViewSwitcher } from "./ViewSwitcher";
import { AvatarStack } from "@/components/presence/AvatarStack";
import {
  notePresenceActivity,
  publishPresence,
  registerPresenceFollow,
  registerPresenceResend,
  setPresenceAxes,
} from "@/stores/presence-store";
import { useColumns, useGroups, useRowIds, useSheetStore } from "@/stores/sheet-store";
import { GROUP_COLORS, type ColumnType } from "@/lib/db-types";
import { useUpdateCounts } from "@/app/(app)/s/[sheetId]/updates/use-update-counts";
import { ColumnSummary } from "./ColumnSummary";
import { GroupHeader } from "./GroupHeader";
import { GroupMenu } from "./GroupMenu";
import { useGroupCollapse } from "./useGroupCollapse";
import type { BoardItem, EditSession, HistoryEntry } from "./types";
import { compareSortedIds, deriveRowOrder, highlightSpans, mergePinnedRows, normalizeSearchText } from "@/lib/sheets/view";
import { textToCellValue } from "@/lib/sheets/paste";
import { displayValue } from "@/lib/sheets/values";
import { parseTSV, toTSV } from "./clipboard";
import { useMe, canDo } from "./MeContext";
import { GridCell } from "./Cell";
import { displayText } from "./renderers/CellValue";
import { ADD_COLUMN_WIDTH, AddColumnButton } from "./AddColumnButton";
import { nameForNewColumn, settingsForNewColumn } from "./ColumnMenu";
import { HeaderCell } from "./HeaderCell";
import { RowContextMenu } from "./RowContextMenu";
import { RowGutter } from "./RowGutter";
import { clearHistory, pushHistory, redoEntry, undoEntry } from "./undo";
import { useDirectory } from "./useDirectory";
import { useGridKeyboard } from "./useGridKeyboard";
import { selectionBounds, useSelection } from "./useSelection";
import { FindReplace } from "./FindReplace";
import { SavedViews } from "./SavedViews";
import { CellCommentsProvider } from "./CellComments";
import { VersionHistory } from "./VersionHistory";

const NO_ROWS: never[] = [];
const NO_TABLE_STATE = {};
const GUTTER = 48;
const HEADER_SLOT = 40;
const COLUMN_SLOT = 32;
const ROW_SLOT = 42;
const FOOT_SLOT = 40;

function slotSize(kind: string | undefined): number {
  if (kind === "header") {
    return HEADER_SLOT;
  }
  if (kind === "columns") {
    return COLUMN_SLOT;
  }
  if (kind === "row") {
    return ROW_SLOT;
  }
  return FOOT_SLOT;
}
const pasteBundles = new WeakMap<HistoryEntry, HistoryEntry[]>();

export function Grid({
  sheetId,
  workbookId,
  workbookName,
  onToast,
  onOpenItem,
}: {
  sheetId: string;
  workbookId: string;
  workbookName: string;
  onToast: (message: string) => void;
  onOpenItem?: (rowId: string) => void;
}) {
  const store = useSheetStore();
  const dispatch = useSheetDispatch();
  const columns = useColumns();
  const groups = useGroups();
  const sourceRowIds = useRowIds();
  const collapse = useGroupCollapse(sheetId);
  const updateCounts = useUpdateCounts(sheetId);
  const nameColumnId = columns.find((column) => column.type === "text")?.id ?? columns[0]?.id;
  const rows = useStore(store, (state) => state.rows);
  const direction = useStore(store, (state) => state.sheet.direction);
  const sheetName = useStore(store, (state) => state.sheet.name);
  const archived = useStore(store, (state) => state.archived);
  const { users } = useDirectory();
  const me = useMe();
  const view = useViewState(sheetId);
  const { layout, setLayout } = useBoardLayout(sheetId);
  const [pinned, setPinned] = useState<string[]>([]);
  const [filterNotice, setFilterNotice] = useState(false);
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user.fullName])), [users]);
  const viewKey = `${view.search}\n${view.mine}\n${view.today}\n${JSON.stringify(view.sort)}\n${JSON.stringify(view.filters)}`;
  useEffect(() => {
    setPinned([]);
  }, [viewKey]);
  const appliedView = useMemo(
    () => ({
      search: view.search,
      filters: view.filters,
      sort: view.sort,
      mine: view.mine,
      today: view.today,
    }),
    [view.search, view.filters, view.sort, view.mine, view.today],
  );
  const rowsByGroup = useMemo(() => {
    const firstGroupId = groups[0]?.id;
    const map = new Map<string, string[]>();
    for (const group of groups) {
      const source = sourceRowIds.filter((id) => {
        const groupId = rows[id]?.groupId;
        return groupId === group.id || (!groupId && group.id === firstGroupId);
      });
      const derived = deriveRowOrder(rows, source, columns, appliedView, { id: me.id }, usersById);
      map.set(
        group.id,
        mergePinnedRows(
          source,
          derived,
          pinned,
          appliedView.sort ? compareSortedIds(rows, columns, appliedView.sort, usersById) : null,
        ).ids,
      );
    }
    return map;
  }, [groups, sourceRowIds, rows, columns, appliedView, me.id, usersById, pinned]);
  const boardItems = useMemo(() => {
    const items: BoardItem[] = [];
    for (const group of groups) {
      items.push({ kind: "header", groupId: group.id, key: `header:${group.id}` });
      if (collapse.isCollapsed(group.id)) {
        continue;
      }
      items.push({ kind: "columns", groupId: group.id, key: `columns:${group.id}` });
      for (const rowId of rowsByGroup.get(group.id) ?? []) {
        items.push({ kind: "row", groupId: group.id, rowId, key: `row:${rowId}` });
      }
      items.push({ kind: "group-summary", groupId: group.id, key: `summary:${group.id}` });
      items.push({ kind: "add-item", groupId: group.id, key: `add:${group.id}` });
    }
    items.push({ kind: "sheet-summary", key: "sheet-summary" });
    return items;
  }, [groups, rowsByGroup, collapse]);
  const rowIds = useMemo(
    () => boardItems.flatMap((item) => (item.kind === "row" ? [item.rowId] : [])),
    [boardItems],
  );
  const unmatched = useMemo(() => new Set<string>(), []);
  const columnIds = useMemo(() => columns.map((column) => column.id), [columns]);
  const { selection, setSelection, selectCell, selectRow, selectColumn, move, moveTab } = useSelection(rowIds, columnIds);
  const [edit, setEdit] = useState<EditSession | null>(null);
  const [drag, setDrag] = useState<{ id: string; width: number } | null>(null);
  const [flash, setFlash] = useState<{ rowId: string; columnId: string } | null>(null);
  const [renaming, setRenaming] = useState<{ columnId: string; groupId: string } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ rowId: string; x: number; y: number } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ groupId: string; x: number; y: number } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: number; message: string; run: () => void } | null>(null);
  const undoSeq = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollNode, setScrollNode] = useState<HTMLDivElement | null>(null);
  const bindScroll = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setScrollNode(node);
  }, []);
  const protection = useProtection();
  const readOnly = archived || !canDo(me, "cell.edit") || protection.tabLocked;
  /** Locked column, or a row in a locked group (rows without a group sit in the first one). */
  const isCellLocked = (rowId: string, columnId: string): boolean => {
    if (protection.lockedColumns.has(columnId)) {
      return true;
    }
    const state = store.getState();
    const group = state.rows[rowId]?.groupId ?? groups[0]?.id;
    return group !== undefined && protection.lockedGroups.has(group);
  };
  const lockRef = useRef(isCellLocked);
  lockRef.current = isCellLocked;
  const [protectGroup, setProtectGroup] = useState<{ id: string; name: string } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const canResize = canDo(me, "column.resize") && !archived;
  const canManage = canDo(me, "column.manage") && !archived;
  const canAddColumn = (canManage || canDo(me, "sheet.create")) && !archived;
  const canDeleteColumn = canDo(me, "column.delete") && !archived;
  const canReorder = canDo(me, "row.move") && !archived && !view.isTransformed;
  const canRowMenu = !archived;
  const canInsert = canDo(me, "row.insert") && !archived;
  const boardItemsRef = useRef(boardItems);
  boardItemsRef.current = boardItems;
  const bounds = selectionBounds(selection, rowIds, columnIds);

  const columnDefs = useMemo(
    () =>
      columns.map((column) => ({
        id: column.id,
        header: column.name,
        size: column.width,
        accessorFn: () => null,
      })),
    [columns],
  );
  const table = useTable(
    {
      features: { ...coreFeatures, columnSizingFeature },
      data: NO_ROWS,
      columns: columnDefs,
    },
    () => NO_TABLE_STATE,
  );
  const leafColumns = table.getAllLeafColumns();
  const widths = leafColumns.map((column) => {
    if (drag?.id === column.id) {
      return drag.width;
    }
    return column.getSize();
  });
  const columnsWidth = GUTTER + widths.reduce((sum, width) => sum + width, 0);
  // Columns up to the last one marked "frozen" stick after the row gutter.
  const frozenCount = columns.reduce((last, column, index) => (column.settings.frozen === true ? index + 1 : last), 0);
  const frozenStarts: number[] = [];
  for (let index = 0, start = GUTTER; index < frozenCount; index += 1) {
    frozenStarts.push(start);
    start += widths[index] ?? columns[index]?.width ?? 0;
  }
  const totalWidth = columnsWidth + (canAddColumn ? ADD_COLUMN_WIDTH : 0);

  const virtualizer = useVirtualizer({
    count: boardItems.length,
    getScrollElement: () => scrollNode,
    estimateSize: (index) => slotSize(boardItems[index]?.kind),
    overscan: 12,
    getItemKey: (index) => boardItems[index]?.key ?? index,
  });

  useLayoutEffect(() => {
    if (!scrollNode) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      virtualizer.measure();
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollNode, virtualizer]);

  useEffect(() => {
    return () => clearHistory(sheetId);
  }, [sheetId]);

  useEffect(() => {
    setPresenceAxes(rowIds, columnIds);
  }, [rowIds, columnIds]);

  const focusRow = selection?.focus.rowId ?? "";
  const focusColumn = selection?.focus.columnId ?? "";
  const rangeStartRow = bounds ? rowIds[bounds.rowStart] ?? "" : "";
  const rangeEndRow = bounds ? rowIds[bounds.rowEnd] ?? "" : "";
  const rangeStartColumn = bounds ? columnIds[bounds.colStart] ?? "" : "";
  const rangeEndColumn = bounds ? columnIds[bounds.colEnd] ?? "" : "";
  const presencePayload = useRef({
    sheetId,
    activeCell: null as { rowId: string; columnId: string } | null,
    selection: null as { startRow: string; endRow: string; startCol: string; endCol: string } | null,
    editing: false,
  });
  presencePayload.current = {
    sheetId,
    activeCell: focusRow && focusColumn ? { rowId: focusRow, columnId: focusColumn } : null,
    selection:
      rangeStartRow && rangeEndRow && rangeStartColumn && rangeEndColumn
        ? { startRow: rangeStartRow, endRow: rangeEndRow, startCol: rangeStartColumn, endCol: rangeEndColumn }
        : null,
    editing: edit !== null,
  };

  useEffect(() => {
    publishPresence(presencePayload.current);
  }, [sheetId, focusRow, focusColumn, rangeStartRow, rangeEndRow, rangeStartColumn, rangeEndColumn, edit]);

  useEffect(() => {
    return registerPresenceResend(() => publishPresence(presencePayload.current));
  }, []);

  useEffect(() => {
    if (!undo) {
      return;
    }
    const timer = window.setTimeout(() => {
      setUndo((current) => (current?.id === undo.id ? null : current));
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) {
      return;
    }
    const apply = () => paintSearchHighlight(root, view.search, rows, columns, usersById);
    apply();
    root.addEventListener("scroll", apply, { passive: true });
    return () => {
      root.removeEventListener("scroll", apply);
      if (typeof CSS !== "undefined" && "highlights" in CSS) {
        CSS.highlights.delete("monitor-search");
      }
    };
  }, [view.search, rowIds, rows, columns, usersById]);

  useEffect(() => {
    const onActivity = () => notePresenceActivity();
    window.addEventListener("pointermove", onActivity);
    window.addEventListener("keydown", onActivity);
    return () => {
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, []);

  useEffect(() => {
    return registerPresenceFollow((rowId, columnId) => {
      const rowIndex = rowIds.indexOf(rowId);
      if (rowIndex < 0) {
        if (store.getState().rowOrder.includes(rowId)) {
          setFilterNotice(true);
        }
        return;
      }
      setFilterNotice(false);
      const boardIndex = boardItems.findIndex((item) => item.kind === "row" && item.rowId === rowId);
      virtualizer.scrollToIndex(boardIndex < 0 ? 0 : boardIndex, { align: "center" });
      window.setTimeout(() => {
        const cell = scrollRef.current?.querySelector(
          `[data-row-id="${CSS.escape(rowId)}"][data-column-id="${CSS.escape(columnId)}"]`,
        );
        cell?.scrollIntoView({ block: "center", inline: "center" });
        setFlash({ rowId, columnId });
        window.setTimeout(() => setFlash(null), 1200);
      }, 250);
    });
  }, [rowIds, boardItems, virtualizer, store]);

  function focusGrid(): void {
    scrollRef.current?.focus();
  }

  function record(type: SheetOp["type"], payload: SheetOp["payload"]): void {
    const current = store.getState();
    const local = {
      columns: current.columns,
      columnOrder: current.columnOrder,
      rows: current.rows,
      rowOrder: current.rowOrder,
      groups: current.groups,
      groupOrder: current.groupOrder,
    };
    const applied = applyOpToState(local, {
      clientOpId: "00000000-0000-4000-8000-000000000000",
      sheetId,
      type,
      payload,
    } as SheetOp);
    if (applied.state === local) {
      return;
    }
    pushHistory(sheetId, {
      forward: { type, payload },
      inverse: { type: applied.inverse.type, payload: applied.inverse.payload },
    });
    pinEdited(type, payload);
    dispatch(type, payload);
  }

  function pinEdited(type: SheetOp["type"], payload: SheetOp["payload"]): void {
    const ids: string[] = [];
    if ((type === "cell.set" || type === "row.insert") && "rowId" in payload && typeof payload.rowId === "string") {
      ids.push(payload.rowId);
    }
    if (type === "cells.setMany" && "cells" in payload && Array.isArray(payload.cells)) {
      for (const cell of payload.cells) {
        if (cell && typeof cell === "object" && "rowId" in cell && typeof cell.rowId === "string") {
          ids.push(cell.rowId);
        }
      }
    }
    if (type === "rows.insertMany" && "rows" in payload && Array.isArray(payload.rows)) {
      for (const row of payload.rows) {
        if (row && typeof row === "object" && "rowId" in row && typeof row.rowId === "string") {
          ids.push(row.rowId);
        }
      }
    }
    if (!ids.length) {
      return;
    }
    setPinned((current) => {
      const next = new Set(current);
      for (const id of ids) {
        next.add(id);
      }
      return next.size === current.length ? current : [...next];
    });
  }

  function recordCells(cells: Array<{ rowId: string; columnId: string; value: JsonValue | null }>): void {
    for (let offset = 0; offset < cells.length; offset += 5000) {
      const slice = cells.slice(offset, offset + 5000);
      if (slice.length > 0) {
        record("cells.setMany", { cells: slice });
      }
    }
  }

  function play(entry: HistoryEntry | null, direction: "undo" | "redo"): void {
    if (!entry || readOnly) {
      return;
    }
    const rest = pasteBundles.get(entry) ?? [];
    const steps =
      direction === "undo"
        ? [...rest].reverse().map((step) => step.inverse).concat([entry.inverse])
        : [entry.forward, ...rest.map((step) => step.forward)];
    for (const step of steps) {
      dispatch(step.type, step.payload);
    }
    setEdit(null);
    focusGrid();
  }

  const actions = useRef({
    selectCell,
    selectRow,
    selectColumn,
    move,
    moveTab,
    record,
    focusGrid,
    onToast,
  });
  actions.current = { selectCell, selectRow, selectColumn, move, moveTab, record, focusGrid, onToast };

  const onSelect = useCallback((rowId: string, columnId: string, extend: boolean) => {
    actions.current.selectCell(rowId, columnId, extend);
    setEdit(null);
    actions.current.focusGrid();
  }, []);

  const onOpen = useCallback((rowId: string, columnId: string) => {
    if (lockRef.current(rowId, columnId)) {
      actions.current.onToast("This part of the sheet is protected.");
      return;
    }
    setEdit({ rowId, columnId, seed: null });
  }, []);

  const onToggle = useCallback((rowId: string, columnId: string) => {
    if (lockRef.current(rowId, columnId)) {
      actions.current.onToast("This part of the sheet is protected.");
      return;
    }
    const current = store.getState().rows[rowId]?.data[columnId];
    actions.current.record("cell.set", { rowId, columnId, value: current === true ? false : true });
  }, [store]);

  const onCommit = useCallback((rowId: string, columnId: string, value: JsonValue | null, moveBy: "down" | "next" | "none") => {
    actions.current.record("cell.set", { rowId, columnId, value });
    setEdit(null);
    if (moveBy === "down") {
      actions.current.move(1, 0, false);
    } else if (moveBy === "next") {
      actions.current.moveTab(false);
    }
    actions.current.focusGrid();
  }, []);

  const onCancel = useCallback(() => {
    setEdit(null);
    actions.current.focusGrid();
  }, []);

  const onInvalid = useCallback((message: string) => {
    actions.current.onToast(message);
  }, []);

  const onAddOption = useCallback((columnId: string, options: Array<{ id: string; label: string; color: string }>) => {
    actions.current.record("column.update", { columnId, patch: { settings: { options } } });
  }, []);

  const onOpenLink = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  function openEdit(seed: string | null): void {
    if (!selection) {
      return;
    }
    const column = store.getState().columns[selection.focus.columnId];
    if (!column || column.type === "checkbox") {
      return;
    }
    if (isCellLocked(selection.focus.rowId, selection.focus.columnId)) {
      onToast("This part of the sheet is protected.");
      return;
    }
    setEdit({ rowId: selection.focus.rowId, columnId: selection.focus.columnId, seed });
  }

  function selectedRowIds(): string[] {
    if (!bounds) {
      return [];
    }
    return rowIds.slice(bounds.rowStart, bounds.rowEnd + 1);
  }

  function selectedColumnIds(): string[] {
    if (!bounds) {
      return [];
    }
    return columnIds.slice(bounds.colStart, bounds.colEnd + 1);
  }

  function deleteColumns(ids: string[]): void {
    if (!ids.length || !canDeleteColumn) {
      return;
    }
    if (ids.length >= columnIds.length) {
      onToast("Keep at least one column.");
      return;
    }
    for (const columnId of ids) {
      record("column.delete", { columnId });
    }
    offerUndo(ids.length === 1 ? "Column deleted" : `${ids.length} columns deleted`, () => {
      for (const columnId of ids) {
        record("column.restore", { columnId });
      }
    });
    setSelection(null);
  }

  function clearSelection(): void {
    if (!bounds) {
      return;
    }
    if (selection?.kind === "row") {
      const allowed = selectedRowIds().filter((rowId) =>
        !me.viewOnly && canDeleteRow(me, { created_by: store.getState().rows[rowId]?.createdBy ?? null }),
      );
      if (allowed.length === 0) {
        onToast("You can only delete rows you created.");
        return;
      }
      deleteRows(allowed);
      setSelection(null);
      return;
    }
    if (selection?.kind === "column") {
      deleteColumns(selectedColumnIds());
      return;
    }
    const cells: Array<{ rowId: string; columnId: string; value: null }> = [];
    for (let rowIndex = bounds.rowStart; rowIndex <= bounds.rowEnd; rowIndex += 1) {
      for (let columnIndex = bounds.colStart; columnIndex <= bounds.colEnd; columnIndex += 1) {
        const rowId = rowIds[rowIndex];
        const columnId = columnIds[columnIndex];
        if (rowId && columnId) {
          cells.push({ rowId, columnId, value: null });
        }
      }
    }
    recordCells(cells);
  }

  function copySelection(): void {
    if (!bounds) {
      return;
    }
    const current = store.getState();
    const copied: string[][] = [];
    for (let rowIndex = bounds.rowStart; rowIndex <= bounds.rowEnd; rowIndex += 1) {
      const line: string[] = [];
      for (let columnIndex = bounds.colStart; columnIndex <= bounds.colEnd; columnIndex += 1) {
        const rowId = rowIds[rowIndex];
        const columnId = columnIds[columnIndex];
        const column = columnId ? current.columns[columnId] : undefined;
        const value = rowId && columnId ? current.rows[rowId]?.data[columnId] : undefined;
        line.push(column ? copiedValue(column, value, usersById) : "");
      }
      copied.push(line);
    }
    const text = toTSV(copied);
    void navigator.clipboard?.writeText(text);
  }

  function recordGrouped(ops: Array<{ type: SheetOp["type"]; payload: SheetOp["payload"] }>): void {
    const current = store.getState();
    let local = {
      columns: current.columns,
      columnOrder: current.columnOrder,
      rows: current.rows,
      rowOrder: current.rowOrder,
      groups: current.groups,
      groupOrder: current.groupOrder,
    };
    const steps: HistoryEntry[] = [];
    for (const op of ops) {
      const applied = applyOpToState(local, {
        clientOpId: "00000000-0000-4000-8000-000000000000",
        sheetId,
        type: op.type,
        payload: op.payload,
      } as SheetOp);
      if (applied.state === local) {
        continue;
      }
      steps.push({
        forward: { type: op.type, payload: op.payload },
        inverse: { type: applied.inverse.type, payload: applied.inverse.payload },
      });
      local = {
        columns: applied.state.columns,
        columnOrder: applied.state.columnOrder,
        rows: applied.state.rows,
        rowOrder: applied.state.rowOrder,
        groups: applied.state.groups,
        groupOrder: applied.state.groupOrder,
      };
    }
    const [first, ...rest] = steps;
    if (!first) {
      return;
    }
    if (rest.length > 0) {
      pasteBundles.set(first, rest);
    }
    pushHistory(sheetId, first);
    for (const step of steps) {
      pinEdited(step.forward.type, step.forward.payload);
      dispatch(step.forward.type, step.forward.payload);
    }
  }

  function pasteText(text: string): void {
    if (!selection || readOnly) {
      return;
    }
    const startRow = rowIds.indexOf(selection.focus.rowId);
    const startColumn = columnIds.indexOf(selection.focus.columnId);
    if (startRow < 0 || startColumn < 0) {
      return;
    }
    const parsed = parseTSV(text);
    if (parsed.length === 0) {
      return;
    }
    const current = store.getState();
    const extra = startRow + parsed.length - rowIds.length;
    const lastId = rowIds[rowIds.length - 1];
    const created =
      extra > 0
        ? generateNKeysBetween(lastId ? current.rows[lastId]?.position ?? null : null, null, extra).map((position) => ({
            rowId: crypto.randomUUID(),
            position,
            groupId: current.rows[selection.focus.rowId]?.groupId ?? groups[groups.length - 1]?.id,
          }))
        : [];
    const ids = [...rowIds, ...created.map((row) => row.rowId)];
    const cells: Array<{ rowId: string; columnId: string; value: JsonValue | null }> = [];
    let skipped = 0;
    parsed.forEach((line, rowOffset) => {
      line.forEach((raw, columnOffset) => {
        const rowId = ids[startRow + rowOffset];
        const columnId = columnIds[startColumn + columnOffset];
        const column = columnId ? current.columns[columnId] : undefined;
        if (!rowId || !column) {
          return;
        }
        const result = textToCellValue(column, raw, usersById);
        if (!result.ok) {
          skipped += 1;
          return;
        }
        cells.push({ rowId, columnId, value: result.value ?? null });
      });
    });
    const rowOps = chunkOps(created, 1000).map((rows) => ({
      type: "rows.insertMany" as const,
      payload: { rows },
    }));
    const cellOps = chunkOps(cells, 5000).map((slice) => ({
      type: "cells.setMany" as const,
      payload: { cells: slice },
    }));
    if (rowOps.length > 0 && cellOps.length > 0) {
      recordGrouped([...rowOps, ...cellOps]);
    } else {
      for (const op of rowOps) {
        record(op.type, op.payload);
      }
      recordCells(cells);
    }
    if (skipped > 0) {
      onToast(`Skipped ${skipped} invalid ${skipped === 1 ? "value" : "values"}.`);
    }
  }

  function toggleActiveCheckbox(): void {
    if (!selection) {
      return;
    }
    const column = store.getState().columns[selection.focus.columnId];
    if (column?.type === "checkbox") {
      onToggle(selection.focus.rowId, selection.focus.columnId);
    }
  }

  const onKeyDown = useGridKeyboard({
    direction,
    readOnly,
    editing: edit !== null,
    onMove: (rowDelta, columnDelta, extend) => {
      move(rowDelta, columnDelta, extend);
      const nextRow = Math.max(0, rowIds.indexOf(selection?.focus.rowId ?? ""));
      const nextId = rowIds[Math.min(rowIds.length - 1, Math.max(0, nextRow + rowDelta))];
      const boardIndex = boardItems.findIndex((item) => item.kind === "row" && item.rowId === nextId);
      virtualizer.scrollToIndex(boardIndex < 0 ? 0 : boardIndex);
    },
    onTab: (backward) => moveTab(backward),
    onEdit: openEdit,
    onClear: clearSelection,
    onCopy: copySelection,
    onUndo: () => play(undoEntry(sheetId), "undo"),
    onRedo: () => play(redoEntry(sheetId), "redo"),
    onToggleCheckbox: toggleActiveCheckbox,
    onFind: () => setFindOpen(true),
  });

  function targetGroupId(): string | undefined {
    const focusId = selection?.focus.rowId;
    if (focusId && store.getState().rows[focusId]?.groupId) {
      return store.getState().rows[focusId]?.groupId ?? undefined;
    }
    return groups[groups.length - 1]?.id;
  }

  function lastRowInGroup(groupId: string | undefined): string | undefined {
    if (!groupId) {
      return store.getState().rowOrder[store.getState().rowOrder.length - 1];
    }
    return store.getState().rowOrder.filter((id) => store.getState().rows[id]?.groupId === groupId).at(-1);
  }

  function addRows(): void {
    if (readOnly) {
      return;
    }
    const current = store.getState();
    const groupId = targetGroupId();
    const lastId = lastRowInGroup(groupId);
    const created = generateNKeysBetween(
      lastId ? current.rows[lastId]?.position ?? null : null,
      null,
      10,
    ).map((position) => ({
      rowId: crypto.randomUUID(),
      position,
      groupId,
    }));
    record("rows.insertMany", { rows: created });
    const firstId = created[0]?.rowId;
    const columnId = columnIds[0];
    if (firstId && columnId) {
      setSelection({
        kind: "cell",
        anchor: { rowId: firstId, columnId },
        focus: { rowId: firstId, columnId },
      });
    }
    requestAnimationFrame(() => virtualizer.scrollToIndex(Math.max(0, boardItems.length - 1)));
  }

  function offerUndo(message: string, run: () => void): void {
    undoSeq.current += 1;
    setUndo({ id: undoSeq.current, message, run });
  }

  function createColumn(type: ColumnType): void {
    const current = store.getState();
    const ids = current.columnOrder;
    const lastId = ids[ids.length - 1];
    const columnId = crypto.randomUUID();
    const settings = settingsForNewColumn(type);
    record("column.insert", {
      columnId,
      name: nameForNewColumn(
        type,
        ids.map((id) => current.columns[id]?.name ?? ""),
      ),
      type,
      position: generateKeyBetween(lastId ? current.columns[lastId]?.position ?? null : null, null),
      ...(type === "timeline" ? { width: 280 } : {}),
      ...(settings ? { settings } : {}),
    });
    const firstGroupId = groups[0]?.id;
    if (firstGroupId) {
      setRenaming({ columnId, groupId: firstGroupId });
    }
  }

  function insertRow(rowId: string, where: "above" | "below"): void {
    const current = store.getState();
    const index = current.rowOrder.indexOf(rowId);
    if (index < 0) {
      return;
    }
    const before = where === "above" ? current.rowOrder[index - 1] : rowId;
    const after = where === "above" ? rowId : current.rowOrder[index + 1];
    const newId = crypto.randomUUID();
    record("row.insert", {
      rowId: newId,
      position: generateKeyBetween(
        before ? current.rows[before]?.position ?? null : null,
        after ? current.rows[after]?.position ?? null : null,
      ),
      groupId: current.rows[rowId]?.groupId ?? undefined,
    });
  }

  function duplicateRow(rowId: string): void {
    const current = store.getState();
    const row = current.rows[rowId];
    const index = current.rowOrder.indexOf(rowId);
    if (!row || index < 0) {
      return;
    }
    const after = current.rowOrder[index + 1];
    const newId = crypto.randomUUID();
    record("row.insert", {
      rowId: newId,
      position: generateKeyBetween(row.position, after ? current.rows[after]?.position ?? null : null),
      data: structuredClone(row.data),
      groupId: row.groupId ?? undefined,
    });
  }

  function deleteRows(ids: string[]): void {
    if (!ids.length) {
      return;
    }
    record("row.delete", { rowIds: ids });
    offerUndo(ids.length === 1 ? "Row deleted" : `${ids.length} rows deleted`, () => {
      record("row.restore", { rowIds: ids });
    });
    setSelection(null);
  }

  function menuRowIds(clickedId: string): string[] {
    if (!bounds || columnIds.length === 0) {
      return [clickedId];
    }
    const fullRows = bounds.colStart === 0 && bounds.colEnd === columnIds.length - 1;
    if (!fullRows) {
      return [clickedId];
    }
    const selected = rowIds.slice(bounds.rowStart, bounds.rowEnd + 1);
    return selected.includes(clickedId) ? selected : [clickedId];
  }

  function startRowDrag(rowId: string, event: React.PointerEvent<HTMLButtonElement>): void {
    if (!canReorder) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const scroller = scrollRef.current;
    if (!scroller) {
      return;
    }
    setDraggingRowId(rowId);
    let dropAt = store.getState().rowOrder.indexOf(rowId);
    let edge = 0;
    const update = (clientY: number) => {
      const rect = scroller.getBoundingClientRect();
      edge = clientY < rect.top + 72 ? -1 : clientY > rect.bottom - 28 ? 1 : 0;
      const y = clientY - rect.top + scroller.scrollTop;
      dropAt = indexAtY(y, boardItemsRef.current);
      setDropIndex(dropAt);
    };
    const tick = () => {
      if (edge < 0) {
        scroller.scrollTop -= 18;
      } else if (edge > 0) {
        scroller.scrollTop += 18;
      }
      frame = window.requestAnimationFrame(tick);
    };
    let frame = window.requestAnimationFrame(tick);
    const move = (pointer: PointerEvent) => update(pointer.clientY);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.cancelAnimationFrame(frame);
      setDropIndex(null);
      setDraggingRowId(null);
      finishRowMove(rowId, dropAt);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  function finishRowMove(rowId: string, dropAt: number): void {
    const current = store.getState();
    const items = boardItemsRef.current;
    const target = items[Math.min(Math.max(0, dropAt), items.length - 1)];
    if (!target || target.kind === "sheet-summary") {
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup) {
        return;
      }
      const lastId = lastRowInGroup(lastGroup.id);
      if (lastId === rowId) {
        return;
      }
      record("row.move", {
        rowId,
        position: generateKeyBetween(lastId ? current.rows[lastId]?.position ?? null : null, null),
        groupId: lastGroup.id,
      });
      return;
    }
    const groupId = target.groupId;
    const groupRows = (rowsByGroup.get(groupId) ?? []).filter((id) => id !== rowId);
    let before: string | null = null;
    let after: string | null = null;
    if (target.kind === "row") {
      if (target.rowId === rowId) {
        return;
      }
      after = target.rowId;
      const index = groupRows.indexOf(target.rowId);
      before = groupRows[index - 1] ?? null;
    } else if (target.kind === "header" || target.kind === "columns") {
      after = groupRows[0] ?? null;
    } else {
      before = groupRows[groupRows.length - 1] ?? null;
    }
    record("row.move", {
      rowId,
      position: generateKeyBetween(
        before ? current.rows[before]?.position ?? null : null,
        after ? current.rows[after]?.position ?? null : null,
      ),
      groupId,
    });
  }

  function addItem(groupId: string): void {
    if (readOnly) {
      return;
    }
    const current = store.getState();
    const lastId = lastRowInGroup(groupId);
    const newId = crypto.randomUUID();
    record("row.insert", {
      rowId: newId,
      position: generateKeyBetween(lastId ? current.rows[lastId]?.position ?? null : null, null),
      groupId,
    });
  }

  function addGroup(): void {
    if (!canInsert) {
      return;
    }
    const current = store.getState();
    const lastId = current.groupOrder[current.groupOrder.length - 1];
    const color = GROUP_COLORS[current.groupOrder.length % GROUP_COLORS.length] ?? "#579bfc";
    record("group.insert", {
      groupId: crypto.randomUUID(),
      name: "New group",
      color,
      position: generateKeyBetween(lastId ? current.groups[lastId]?.position ?? null : null, null),
    });
  }

  function duplicateGroup(groupId: string): void {
    const current = store.getState();
    const group = current.groups[groupId];
    if (!group) {
      return;
    }
    const index = current.groupOrder.indexOf(groupId);
    const after = current.groupOrder[index + 1];
    const newGroupId = crypto.randomUUID();
    const sourceRows = current.rowOrder.filter((id) => current.rows[id]?.groupId === groupId);
    const positions = generateNKeysBetween(null, null, Math.max(1, sourceRows.length));
    record("group.duplicate", {
      sourceGroupId: groupId,
      groupId: newGroupId,
      name: `${group.name} (copy)`,
      color: group.color,
      position: generateKeyBetween(group.position, after ? current.groups[after]?.position ?? null : null),
      rows: sourceRows.map((id, rowIndex) => ({
        rowId: crypto.randomUUID(),
        position: positions[rowIndex] ?? group.position,
        data: structuredClone(current.rows[id]?.data ?? {}),
      })),
    });
  }

  function startGroupDrag(groupId: string, event: React.PointerEvent<HTMLButtonElement>): void {
    if (!canInsert) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const scroller = scrollRef.current;
    if (!scroller) {
      return;
    }
    let dropAt = boardItemsRef.current.findIndex((item) => item.kind === "header" && item.groupId === groupId);
    const move = (pointer: PointerEvent) => {
      const rect = scroller.getBoundingClientRect();
      const y = pointer.clientY - rect.top + scroller.scrollTop - 36;
      dropAt = indexAtY(y, boardItemsRef.current);
      setDropIndex(dropAt);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      setDropIndex(null);
      finishGroupMove(groupId, dropAt);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  function finishGroupMove(groupId: string, dropAt: number): void {
    const current = store.getState();
    const headers = boardItemsRef.current.filter((item) => item.kind === "header");
    const target = boardItemsRef.current[Math.min(Math.max(0, dropAt), boardItemsRef.current.length - 1)];
    const targetGroupId = target && target.kind !== "sheet-summary" ? target.groupId : headers[headers.length - 1]?.groupId;
    if (!targetGroupId || targetGroupId === groupId) {
      return;
    }
    const order = current.groupOrder.filter((id) => id !== groupId);
    const at = order.indexOf(targetGroupId);
    if (at < 0) {
      return;
    }
    order.splice(at, 0, groupId);
    const insertAt = order.indexOf(groupId);
    const prev = order[insertAt - 1];
    const next = order[insertAt + 1];
    record("group.move", {
      groupId,
      position: generateKeyBetween(
        prev ? current.groups[prev]?.position ?? null : null,
        next ? current.groups[next]?.position ?? null : null,
      ),
    });
  }

  function startResize(columnId: string, width: number, event: ReactMouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const latest = { width };
    const moveDrag = (moveEvent: MouseEvent) => {
      const delta = direction === "rtl" ? startX - moveEvent.clientX : moveEvent.clientX - startX;
      latest.width = Math.min(800, Math.max(60, Math.round(width + delta)));
      setDrag({ id: columnId, width: latest.width });
    };
    const stopDrag = () => {
      window.removeEventListener("mousemove", moveDrag);
      window.removeEventListener("mouseup", stopDrag);
      setDrag(null);
      if (latest.width !== width) {
        record("column.resize", { columnId, width: latest.width });
      }
    };
    window.addEventListener("mousemove", moveDrag);
    window.addEventListener("mouseup", stopDrag);
  }

  const banner = archived
    ? "This sheet is read-only because it is archived."
    : protection.tabLocked
      ? "This tab is protected. Only the people the owner chose can edit it."
      : !canDo(me, "cell.edit")
      ? "You don't have permission to edit cells."
      : "";

  return (
    <CellCommentsProvider sheetId={sheetId} canResolve={!me.viewOnly && !archived}>
    <div className="flex h-full min-h-0 flex-col">
      <style>{`@keyframes presence-flash { 0%, 100% { box-shadow: inset 0 0 0 0 transparent; } 40% { box-shadow: inset 0 0 0 3px var(--primary); } } ::highlight(monitor-search) { background-color: #fdab3d; color: var(--text); }`}</style>
      <AvatarStack />
      {banner ? (
        <p role="status" className="bg-row px-3 py-1 text-xs text-muted">
          {banner}
        </p>
      ) : null}
      <ViewSwitcher layout={layout} onChange={setLayout} />
      <Toolbar
        direction={direction}
        columns={columns}
        users={users}
        workbookId={workbookId}
        workbookName={workbookName}
        search={view.search}
        filters={view.filters}
        sort={view.sort}
        mine={view.mine}
        today={view.today}
        shown={rowIds.length}
        total={sourceRowIds.length}
        onSearch={view.setSearch}
        onSort={view.setSort}
        onMine={view.setMine}
        onToday={view.setToday}
        filterActive={view.filterActive}
        onFilterActive={view.setFilterActive}
        onClear={() => {
          view.clear();
          setFilterNotice(false);
        }}
        views={
          <>
          <SavedViews
            sheetId={sheetId}
            current={{ search: view.search, filters: view.filters, sort: view.sort, mine: view.mine, today: view.today }}
            canSave={!me.viewOnly && !archived}
            onApply={(saved) => {
              view.apply(saved);
              setFilterNotice(false);
            }}
          />
          <VersionHistory sheetId={sheetId} tabName={sheetName} />
          </>
        }
      />
      <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={layout}
        className="flex min-h-0 flex-1 flex-col"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
      {findOpen && layout === "table" ? (
        <div className="relative">
          <FindReplace
            rows={rows}
            rowIds={rowIds}
            columns={columns}
            usersById={usersById}
            canReplace={!readOnly && !me.assignedOnly}
            isLocked={isCellLocked}
            onGoTo={(match) => {
              actions.current.selectCell(match.rowId, match.columnId, false);
              const boardIndex = boardItemsRef.current.findIndex((item) => item.kind === "row" && item.rowId === match.rowId);
              if (boardIndex >= 0) {
                virtualizer.scrollToIndex(boardIndex, { align: "center" });
              }
              document.querySelector(`[role=gridcell][data-row-id="${match.rowId}"][data-column-id="${match.columnId}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
            }}
            onReplace={(cells) => recordCells(cells)}
            onClose={() => {
              setFindOpen(false);
              actions.current.focusGrid();
            }}
          />
        </div>
      ) : null}
      {layout === "chart" ? (
        <ChartView
          sheetId={sheetId}
          columns={columns}
          rows={rows}
          rowIds={visibleRowIds(groups, rowsByGroup)}
          usersById={usersById}
        />
      ) : layout === "kanban" ? (
        <KanbanBoard
          direction={direction}
          groups={groups}
          rowsByGroup={rowsByGroup}
          rows={rows}
          rowOrder={sourceRowIds}
          columns={columns}
          users={users}
          nameColumnId={nameColumnId}
          readOnly={readOnly}
          canInsert={canInsert}
          onOpenItem={onOpenItem}
          onCommit={record}
        />
      ) : layout === "timeline" ? (
        <TimelineView
          groups={groups}
          rowsByGroup={rowsByGroup}
          rows={rows}
          columns={columns}
          nameColumnId={nameColumnId}
          readOnly={readOnly}
          isCollapsed={collapse.isCollapsed}
          onToggleGroup={collapse.toggle}
          onOpenItem={onOpenItem}
          onCommit={record}
        />
      ) : (
      <div
        ref={bindScroll}
        role="grid"
        tabIndex={0}
        aria-label="Sheet grid"
        dir={direction}
        className="min-h-0 flex-1 overflow-auto bg-bg font-sans text-[13px] text-text outline-none"
        onKeyDown={onKeyDown}
        onCopy={(event) => {
          if (edit) {
            return;
          }
          copySelection();
          event.preventDefault();
        }}
        onPaste={(event) => {
          if (edit || readOnly) {
            return;
          }
          const text = event.clipboardData.getData("text/plain");
          if (!text) {
            return;
          }
          event.preventDefault();
          pasteText(text);
        }}
        onContextMenu={(event) => {
          const target = event.target;
          if (!(target instanceof Element) || target.closest("[data-column-header]")) {
            return;
          }
          const rowId = target.closest("[data-row-id]")?.getAttribute("data-row-id");
          if (!rowId) {
            return;
          }
          event.preventDefault();
          if (canRowMenu) {
            setRowMenu({ rowId, x: event.clientX, y: event.clientY });
          }
        }}
      >
        <div style={{ width: totalWidth }}>
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {dropIndex !== null ? (
              <div
                className="pointer-events-none absolute start-0 z-20 h-0.5 bg-primary"
                style={{ top: offsetForIndex(dropIndex, boardItems), width: totalWidth }}
              />
            ) : null}
            {virtualizer.getVirtualItems().map((item) => {
              const board = boardItems[item.index];
              if (!board) {
                return null;
              }
              if (board.kind === "header") {
                const group = groups.find((entry) => entry.id === board.groupId);
                if (!group) {
                  return null;
                }
                return (
                  <div
                    key={item.key}
                    className="absolute start-0 top-0 z-10 flex items-end"
                    style={{ height: HEADER_SLOT, transform: `translateY(${item.start}px)`, width: totalWidth }}
                  >
                    <GroupHeader
                      groupId={group.id}
                      name={group.name}
                      color={group.color}
                      count={(rowsByGroup.get(group.id) ?? []).length}
                      collapsed={collapse.isCollapsed(group.id)}
                      width={totalWidth}
                      canEdit={canInsert}
                      canReorder={canInsert}
                      onToggle={() => collapse.toggle(group.id)}
                      onRename={(name) => record("group.update", { groupId: group.id, patch: { name } })}
                      onOpenMenu={(x, y) => setGroupMenu({ groupId: group.id, x, y })}
                      onDragStart={startGroupDrag}
                    />
                  </div>
                );
              }
              if (board.kind === "columns") {
                const group = groups.find((entry) => entry.id === board.groupId);
                if (!group) {
                  return null;
                }
                return (
                  <div
                    key={item.key}
                    className="absolute start-0 top-0 z-20 flex items-end"
                    style={{ height: COLUMN_SLOT, transform: `translateY(${item.start}px)`, width: totalWidth }}
                  >
                    <div className="sticky start-0 z-30 h-8 w-12 shrink-0 bg-surface" />
                    {columns.map((column, index) => (
                      <HeaderCell
                        key={column.id}
                        columnId={column.id}
                        name={column.name}
                        type={column.type}
                        width={widths[index] ?? column.width}
                        selected={Boolean(selection?.kind === "column" && bounds && index >= bounds.colStart && index <= bounds.colEnd)}
                        settings={column.settings}
                        stickyStart={frozenStarts[index]}
                        lastFrozen={index === frozenCount - 1}
                        canResize={canResize}
                        canManage={canManage}
                        direction={direction}
                        index={index}
                        columnCount={columns.length}
                        renaming={renaming?.columnId === column.id && renaming.groupId === group.id}
                        onRenaming={(columnId) => setRenaming(columnId ? { columnId, groupId: group.id } : null)}
                        onCommit={record}
                        onOfferUndo={offerUndo}
                        onSelect={(extend) => {
                          setEdit(null);
                          selectColumn(column.id, extend);
                          focusGrid();
                        }}
                        onResizeStart={(event) => startResize(column.id, widths[index] ?? column.width, event)}
                        canDelete={canDeleteColumn && columnIds.length > 1}
                        canStyle={canDo(me, "cell.edit") && !archived}
                        filterActive={view.filterActive}
                        filtered={view.filters.some((rule) => rule.columnId === column.id && rule.operator === "in_values")}
                        filters={view.filters}
                        sort={view.sort}
                        usersById={usersById}
                        onFilters={view.setFilters}
                        onSort={view.setSort}
                      />
                    ))}
                    {canAddColumn ? (
                      <div className="sticky end-1 z-40 ms-auto flex h-8 w-11 shrink-0 items-center justify-center bg-surface">
                        <AddColumnButton onCreate={createColumn} />
                      </div>
                    ) : null}
                  </div>
                );
              }
              if (board.kind === "group-summary" || board.kind === "sheet-summary") {
                const groupRows =
                  board.kind === "sheet-summary"
                    ? rowIds
                    : (rowsByGroup.get(board.groupId) ?? []);
                return (
                  <div
                    key={item.key}
                    className="absolute start-0 top-0"
                    style={{ height: FOOT_SLOT, transform: `translateY(${item.start}px)`, width: totalWidth }}
                  >
                    <ColumnSummary
                      columns={columns}
                      widths={widths}
                      rows={groupRows.map((id) => store.getState().rows[id]).filter((row) => row !== undefined)}
                      gutter={GUTTER}
                      users={users}
                      frozenStarts={frozenStarts}
                      label={board.kind === "sheet-summary" ? "All" : ""}
                    />
                  </div>
                );
              }
              if (board.kind === "add-item") {
                const group = groups.find((entry) => entry.id === board.groupId);
                return (
                  <div
                    key={item.key}
                    className="absolute start-0 top-0"
                    style={{ height: FOOT_SLOT, transform: `translateY(${item.start}px)`, width: totalWidth }}
                  >
                    <button
                      type="button"
                      aria-label={`Add item to ${group?.name ?? "group"}`}
                      disabled={!canInsert}
                      className="h-10 w-full cursor-pointer rounded-lg px-3 text-start text-[13px] text-muted hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => addItem(board.groupId)}
                    >
                      + Add item
                    </button>
                  </div>
                );
              }
              const rowId = board.rowId;
              const groupColor = groups.find((entry) => entry.id === board.groupId)?.color ?? "#579bfc";
              const rowIndex = rowIds.indexOf(rowId);
              const rowSelected = Boolean(
                selection?.kind === "row" && bounds && rowIndex >= bounds.rowStart && rowIndex <= bounds.rowEnd,
              );
              return (
                <div
                  key={item.key}
                  className={`absolute start-0 top-0 ${edit?.rowId === rowId ? "z-30" : "z-0"}`}
                  style={{ height: ROW_SLOT, transform: `translateY(${item.start}px)`, width: totalWidth }}
                >
                  <div
                    className={`relative flex h-10 rounded-md ${edit?.rowId === rowId ? "overflow-visible" : "overflow-clip"} ${unmatched.has(rowId) ? "bg-amber-500/15" : "bg-row"} hover:bg-row-hover`}
                    title={unmatched.has(rowId) ? "Doesn't match filter" : undefined}
                  >
                    <span className="pointer-events-none absolute inset-y-0 start-0 w-1.5" style={{ backgroundColor: groupColor }} aria-hidden="true" />
                  <RowGutter
                    rowId={rowId}
                    number={rowIndex + 1}
                    selected={rowSelected}
                    canReorder={canReorder}
                    dragging={draggingRowId === rowId}
                    showMenu={canRowMenu}
                    onDragStart={startRowDrag}
                    onOpenMenu={(id, x, y) => setRowMenu({ rowId: id, x, y })}
                    onSelect={(extend) => {
                      setEdit(null);
                      selectRow(rowId, extend);
                      focusGrid();
                    }}
                    canDelete={!me.viewOnly && canDeleteRow(me, { created_by: store.getState().rows[rowId]?.createdBy ?? null })}
                    onDelete={() => deleteRows([rowId])}
                  />
                  {columns.map((column, index) => (
                    <GridCell
                      key={column.id}
                      rowId={rowId}
                      columnId={column.id}
                      width={widths[index] ?? column.width}
                      active={selection?.focus.rowId === rowId && selection.focus.columnId === column.id}
                      inRange={Boolean(
                        bounds &&
                          rowIndex >= bounds.rowStart &&
                          rowIndex <= bounds.rowEnd &&
                          index >= bounds.colStart &&
                          index <= bounds.colEnd,
                      )}
                      editing={edit?.rowId === rowId && edit.columnId === column.id}
                      seed={edit?.rowId === rowId && edit.columnId === column.id ? edit.seed : null}
                      flash={flash?.rowId === rowId && flash.columnId === column.id}
                      readOnly={readOnly}
                      users={users}
                      isNameColumn={column.id === nameColumnId}
                      updateCount={updateCounts[rowId] ?? 0}
                      onSelect={onSelect}
                      onOpen={onOpen}
                      onOpenItem={onOpenItem}
                      onToggle={onToggle}
                      onCommit={onCommit}
                      onCancel={onCancel}
                      onInvalid={onInvalid}
                      onAddOption={onAddOption}
                      onOpenLink={onOpenLink}
                      stickyStart={frozenStarts[index]}
                      lastFrozen={index === frozenCount - 1}
                    />
                  ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="sticky bottom-0 z-10 flex gap-2 border-b border-border bg-surface">
            <button
              type="button"
              aria-label="Add 10 rows"
              disabled={readOnly || columnIds.length === 0}
              className="h-9 cursor-pointer rounded-lg px-3 text-start text-[13px] text-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={addRows}
            >
              + Add 10 rows
            </button>
            {canAddColumn ? <AddColumnButton variant="labeled" onCreate={createColumn} /> : null}
            <button
              type="button"
              aria-label="Add group"
              disabled={!canInsert}
              className="h-9 cursor-pointer rounded-lg px-3 text-start text-[13px] text-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={addGroup}
            >
              + Add group
            </button>
          </div>
        </div>
      </div>
      )}
      </motion.div>
      </AnimatePresence>
      {protectGroup ? (
        <ProtectDialog
          sheetId={sheetId}
          scope="group"
          targetId={protectGroup.id}
          targetName={protectGroup.name}
          onClose={() => setProtectGroup(null)}
        />
      ) : null}
      <RowContextMenu
        menu={rowMenu}
        targets={rowMenu ? menuRowIds(rowMenu.rowId) : []}
        onClose={() => setRowMenu(null)}
        onInsert={insertRow}
        onDuplicate={duplicateRow}
        onDelete={deleteRows}
      />
      <GroupMenu
        open={groupMenu !== null}
        x={groupMenu?.x ?? 0}
        y={groupMenu?.y ?? 0}
        name={groups.find((group) => group.id === groupMenu?.groupId)?.name ?? "Group"}
        color={groups.find((group) => group.id === groupMenu?.groupId)?.color ?? "#579bfc"}
        canDelete={groups.length > 1}
        isProtected={Boolean(
          groupMenu &&
            (protection.lockedGroups.has(groupMenu.groupId) ||
              protection.protections.some((item) => item.scope === "group" && item.targetId === groupMenu.groupId)),
        )}
        onProtect={
          protection.canManage
            ? () => {
                const group = groups.find((item) => item.id === groupMenu?.groupId);
                if (group) {
                  setProtectGroup({ id: group.id, name: group.name });
                }
              }
            : undefined
        }
        onClose={() => setGroupMenu(null)}
        onRename={() => {
          const groupId = groupMenu?.groupId;
          if (!groupId) {
            return;
          }
          const current = groups.find((group) => group.id === groupId);
          const next = window.prompt("Group name", current?.name ?? "");
          if (next && next.trim()) {
            record("group.update", { groupId, patch: { name: next.trim() } });
          }
        }}
        onRecolor={(color) => {
          if (groupMenu) {
            record("group.update", { groupId: groupMenu.groupId, patch: { color } });
          }
        }}
        onDuplicate={() => {
          if (groupMenu) {
            duplicateGroup(groupMenu.groupId);
          }
        }}
        onDelete={() => {
          if (groupMenu) {
            record("group.delete", { groupId: groupMenu.groupId });
          }
        }}
      />
      {filterNotice ? (
        <div role="status" className="fixed bottom-16 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-text px-3 py-2 text-sm text-white">
          <span>Row hidden by your filter. Clear filters?</span>
          <button
            type="button"
            aria-label="Clear filters"
            className="cursor-pointer rounded-lg bg-white/15 px-2 py-1"
            onClick={() => {
              view.clear();
              setFilterNotice(false);
            }}
          >
            Clear filters
          </button>
        </div>
      ) : null}
      {undo ? (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-text px-3 py-2 text-sm text-white"
        >
          <span>{undo.message}</span>
          <button
            type="button"
            aria-label="Undo"
            className="cursor-pointer rounded-lg bg-white/15 px-2 py-1"
            onClick={() => {
              undo.run();
              setUndo(null);
            }}
          >
            Undo
          </button>
        </div>
      ) : null}
    </div>
    </CellCommentsProvider>
  );
}

function paintSearchHighlight(
  root: HTMLElement,
  query: string,
  rows: Record<string, { data: Record<string, JsonValue | undefined> }>,
  columns: Array<{ id: string; type: ColumnType; settings?: unknown }>,
  usersById: ReadonlyMap<string, string>,
): void {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) {
    return;
  }
  CSS.highlights.delete("monitor-search");
  const needle = normalizeSearchText(query);
  if (!needle) {
    return;
  }
  const ranges: Range[] = [];
  for (const cell of root.querySelectorAll<HTMLElement>("[data-row-id][data-column-id]")) {
    const rowId = cell.getAttribute("data-row-id");
    const columnId = cell.getAttribute("data-column-id");
    const column = columns.find((item) => item.id === columnId);
    if (!rowId || !columnId || !column) {
      continue;
    }
    const shown = displayValue(column, rows[rowId]?.data[columnId], usersById);
    if (!normalizeSearchText(shown).includes(needle)) {
      continue;
    }
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      if (!current.parentElement?.closest("[data-presence-name]") && current.textContent) {
        nodes.push(current as Text);
      }
      current = walker.nextNode();
    }
    let highlighted = false;
    for (const node of nodes) {
      for (const [start, end] of highlightSpans(node.textContent ?? "", query)) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, Math.min(end, node.textContent?.length ?? end));
        ranges.push(range);
        highlighted = true;
      }
    }
    if (!highlighted) {
      for (const node of nodes) {
        const range = document.createRange();
        range.selectNodeContents(node);
        ranges.push(range);
      }
    }
  }
  if (ranges.length > 0) {
    CSS.highlights.set("monitor-search", new Highlight(...ranges));
  }
}

function indexAtY(y: number, items: BoardItem[]): number {
  let offset = 0;
  for (let index = 0; index < items.length; index += 1) {
    const size = slotSize(items[index]?.kind);
    if (y < offset + size / 2) {
      return index;
    }
    offset += size;
  }
  return items.length;
}

function offsetForIndex(index: number, items: BoardItem[]): number {
  let offset = 0;
  for (let i = 0; i < index && i < items.length; i += 1) {
    offset += slotSize(items[i]?.kind);
  }
  return offset;
}

function chunkOps<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
}

function copiedValue(
  column: Parameters<typeof displayText>[0],
  value: JsonValue | undefined,
  usersById: Map<string, string>,
): string {
  if (column.type === "person" && Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((id) => usersById.get(id) ?? id)
      .join(", ");
  }
  return displayText(column, value);
}
