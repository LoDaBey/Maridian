"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import type { SheetDirection } from "@/lib/db-types";
import { getSocket } from "@/lib/realtime/client";
import { applyOpToState, type LocalColumn, type LocalRow, type LocalSheetState } from "@/lib/sheets/apply-local";
import type { JsonValue, SheetOp } from "@/lib/sheets/ops";
import { unpackRows, type PackedRows } from "@/lib/sheets/snapshot-pack";
import { createSheetStore, useSheetStore, type PendingOp, type SheetState, type SyncStatus } from "@/stores/sheet-store";

const ACK_MS = 10_000;
/** Joining a 100k-row tab can take a while on a slow connection. */
const JOIN_ACK_MS = 60_000;
const GAP_MS = 1_500;
const RATE_MS = 500;

export type SheetDispatch = <T extends SheetOp["type"]>(
  type: T,
  payload: Extract<SheetOp, { type: T }>["payload"],
) => void;

interface AppliedEvent {
  op: SheetOp;
  version: number;
  clientOpId: string;
}

interface CellChange {
  rowId: string;
  columnId: string;
  value: unknown;
}

interface Stash {
  value: unknown;
  version: number;
}

interface Session {
  sheetId: string;
  userId: string | null;
  store: StoreApi<SheetState>;
  dispatch: SheetDispatch;
  cancelClose: (() => void) | null;
  closeToken: object | null;
  toastListeners: Set<(message: string) => void>;
  destroy: () => void;
}

const sessions = new Map<string, Session>();

declare global {
  interface Window {
    __monitorDispatch?: (type: string, payload: unknown) => void;
  }
}

export function openSheet(sheetId: string, options?: { userId?: string }): StoreApi<SheetState> {
  const existing = sessions.get(sheetId);
  if (existing) {
    if (options?.userId) {
      existing.userId = options.userId;
    }
    existing.cancelClose?.();
    existing.cancelClose = null;
    existing.closeToken = null;
    return existing.store;
  }

  const store = createSheetStore(sheetId);
  const socket = getSocket();
  const buffer = new Map<number, AppliedEvent>();
  const stashes = new Map<string, Stash>();
  const toastListeners = new Set<(message: string) => void>();
  let disposed = false;
  let joined = false;
  let epoch = 0;
  let sending: string | null = null;
  let failedRetry = false;
  let gapTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const session: Session = {
    sheetId,
    userId: options?.userId ?? null,
    store,
    dispatch: (type, payload) => {
      send(type, payload);
    },
    cancelClose: null,
    closeToken: null,
    toastListeners,
    destroy: () => {
      disposed = true;
      epoch += 1;
      sessions.delete(sheetId);
      if (gapTimer) {
        clearTimeout(gapTimer);
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      socket.off("op:applied", onApplied);
      socket.off("sheet:meta", onMeta);
      socket.off("sheet:reset", onReset);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (window.__monitorDispatch === consoleDispatch) {
        delete window.__monitorDispatch;
      }
      socket.emit("sheet:leave", { sheetId });
      const leftover = [...store.getState().pending.values()];
      if (leftover.length) {
        flushDetached(leftover);
      }
    },
  };
  sessions.set(sheetId, session);
  const consoleDispatch = (type: string, payload: unknown): void => {
    send(type, payload);
  };
  if (process.env.NODE_ENV !== "production") {
    window.__monitorDispatch = consoleDispatch;
  }

  socket.on("op:applied", onApplied);
  socket.on("sheet:meta", onMeta);
  socket.on("sheet:reset", onReset);
  socket.on("connect", onConnect);
  socket.on("disconnect", onDisconnect);
  window.addEventListener("beforeunload", onBeforeUnload);
  store.setState({ status: socket.connected ? "connecting" : "offline" });
  if (socket.connected) {
    void join();
  }

  return store;

  function send(type: string, payload: unknown): void {
    if (disposed) {
      return;
    }
    const op = {
      clientOpId: crypto.randomUUID(),
      sheetId,
      type,
      payload,
    } as SheetOp;
    const applied = applyOpToState(localOf(store.getState()), op, session.userId);
    const pending = new Map(store.getState().pending);
    pending.set(op.clientOpId, { op, inverse: applied.inverse, sentAt: 0, attempts: 0 });
    store.setState({
      ...localFields(applied.state),
      pending,
      status: statusFor(pending.size),
    });
    flush();
  }

  function flush(): void {
    if (disposed || sending || !socket.connected || !joined) {
      return;
    }
    const next = [...store.getState().pending.values()][0];
    if (!next) {
      return;
    }
    const epochAtSend = epoch;
    sending = next.op.clientOpId;
    next.attempts += 1;
    next.sentAt = Date.now();
    socket.timeout(ACK_MS).emit("op", wire(next.op), (error: Error | null, result?: unknown) => {
      if (disposed || epoch !== epochAtSend) {
        return;
      }
      sending = null;
      if (error || !isAck(result)) {
        failedRetry = true;
        store.setState({ status: statusFor(store.getState().pending.size), lastError: "Couldn't save." });
        return;
      }
      if (!result.ok && result.code === "rate_limited") {
        failedRetry = true;
        store.setState({ status: "error", lastError: result.message });
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (!disposed && epoch === epochAtSend) {
            flush();
          }
        }, RATE_MS);
        return;
      }
      if (!result.ok) {
        rollback(next, result.message || "Couldn't save.");
        return;
      }
      if (!store.getState().pending.has(next.op.clientOpId)) {
        flush();
        return;
      }
      accept(next, result.version);
    });
  }

  function accept(item: PendingOp, version: number): void {
    const pending = new Map(store.getState().pending);
    pending.delete(item.op.clientOpId);
    let data = localOf(store.getState());
    for (const cell of cellsOf(item.op)) {
      const key = cellKey(cell.rowId, cell.columnId);
      if (touches(pending, cell.rowId, cell.columnId)) {
        continue;
      }
      const stash = stashes.get(key);
      stashes.delete(key);
      if (!stash || stash.version <= version) {
        continue;
      }
      data = applyOpToState(data, {
        clientOpId: item.op.clientOpId,
        sheetId,
        type: "cell.set",
        payload: { rowId: cell.rowId, columnId: cell.columnId, value: stash.value ?? null },
      }).state;
    }
    failedRetry = false;
    store.setState({
      ...localFields(data),
      pending,
      version: Math.max(store.getState().version, version),
      lastSavedAt: pending.size === 0 ? Date.now() : store.getState().lastSavedAt,
      lastError: undefined,
      status: statusFor(pending.size),
    });
    drain();
    flush();
  }

  function rollback(item: PendingOp, message: string): void {
    const pending = new Map(store.getState().pending);
    pending.delete(item.op.clientOpId);
    let data = applyOpToState(localOf(store.getState()), item.inverse).state;
    for (const rest of pending.values()) {
      const applied = applyOpToState(data, rest.op, session.userId);
      if (applied.state !== data) {
        rest.inverse = applied.inverse;
      }
      data = applied.state;
    }
    failedRetry = false;
    store.setState({
      ...localFields(data),
      pending,
      lastError: message,
      status: statusFor(pending.size),
    });
    publishToast(message);
    flush();
  }

  async function join(): Promise<void> {
    if (disposed || !socket.connected) {
      return;
    }
    const epochAtSend = epoch;
    const result = await emitAck(socket, "sheet:join", { sheetId });
    if (disposed || epoch !== epochAtSend) {
      return;
    }
    if (!result || result.ok !== true || !result.snapshot) {
      const message = result && result.ok === false && result.message ? result.message : "Couldn't open this sheet.";
      store.setState({ status: "error", lastError: message });
      publishToast(message);
      return;
    }
    joined = true;
    failedRetry = false;
    const pending = store.getState().pending;
    let data = snapshotState(result.snapshot);
    for (const item of pending.values()) {
      const applied = applyOpToState(data, item.op, session.userId);
      if (applied.state !== data) {
        item.inverse = applied.inverse;
      }
      data = applied.state;
    }
    store.setState({
      sheet: {
        id: result.snapshot.sheet.id,
        name: result.snapshot.sheet.name,
        direction: result.snapshot.sheet.direction,
      },
      version: result.snapshot.sheet.version,
      ...localFields(data),
      pending,
      archived: store.getState().archived,
      lastSavedAt: pending.size === 0 ? Date.now() : store.getState().lastSavedAt,
      lastError: undefined,
      status: statusFor(pending.size),
    });
    flush();
  }

  async function resync(): Promise<void> {
    if (disposed) {
      return;
    }
    epoch += 1;
    sending = null;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (gapTimer) {
      clearTimeout(gapTimer);
      gapTimer = null;
    }
    buffer.clear();
    failedRetry = false;
    await join();
  }

  function onApplied(payload: unknown): void {
    const event = readApplied(payload);
    if (!event || event.op.sheetId !== sheetId || disposed) {
      return;
    }
    const version = store.getState().version;
    if (event.version <= version) {
      return;
    }
    if (event.version !== version + 1) {
      buffer.set(event.version, event);
      if (!gapTimer) {
        gapTimer = setTimeout(() => {
          gapTimer = null;
          if (buffer.size > 0) {
            void resync();
          }
        }, GAP_MS);
      }
      return;
    }
    takeApplied(event);
    drain();
  }

  function drain(): void {
    let next = buffer.get(store.getState().version + 1);
    while (next) {
      buffer.delete(next.version);
      takeApplied(next);
      next = buffer.get(store.getState().version + 1);
    }
    if (buffer.size === 0 && gapTimer) {
      clearTimeout(gapTimer);
      gapTimer = null;
    }
  }

  function takeApplied(event: AppliedEvent): void {
    const pending = store.getState().pending;
    if (event.op.type === "cell.set" || event.op.type === "cells.setMany") {
      for (const cell of cellsOf(event.op)) {
        if (touches(pending, cell.rowId, cell.columnId)) {
          stashes.set(cellKey(cell.rowId, cell.columnId), { value: cell.value, version: event.version });
        }
      }
    }
    let data = applyOpToState(localOf(store.getState()), event.op).state;
    for (const item of pending.values()) {
      const applied = applyOpToState(data, item.op, session.userId);
      if (applied.state !== data) {
        item.inverse = applied.inverse;
      }
      data = applied.state;
    }
    store.setState({
      ...localFields(data),
      version: event.version,
    });
  }

  /** The whole tab changed underneath us (a version was restored): load it again. */
  function onReset(payload: unknown): void {
    if (isRecord(payload) && payload.sheetId === sheetId && !disposed) {
      void resync();
    }
  }

  function onMeta(payload: unknown): void {
    if (!isRecord(payload) || payload.id !== sheetId || disposed) {
      return;
    }
    const current = store.getState().sheet;
    const direction: SheetDirection = payload.direction === "ltr" ? "ltr" : "rtl";
    store.setState({
      sheet: {
        ...current,
        name: typeof payload.name === "string" ? payload.name : current.name,
        direction: payload.direction === "ltr" || payload.direction === "rtl" ? direction : current.direction,
      },
      archived: payload.archived === true,
    });
  }

  function onConnect(): void {
    if (disposed) {
      return;
    }
    if (joined) {
      void resync();
      return;
    }
    void join();
  }

  function onDisconnect(): void {
    if (disposed) {
      return;
    }
    sending = null;
    store.setState({ status: "offline" });
  }

  function onBeforeUnload(event: BeforeUnloadEvent): void {
    if (store.getState().pending.size > 0) {
      event.preventDefault();
      event.returnValue = "";
    }
  }

  function statusFor(pendingSize: number): SyncStatus {
    if (!socket.connected) {
      return "offline";
    }
    if (!joined) {
      return "connecting";
    }
    if (failedRetry && pendingSize > 0) {
      return "error";
    }
    if (pendingSize > 0) {
      return "saving";
    }
    return "saved";
  }

  function publishToast(message: string): void {
    for (const listener of toastListeners) {
      listener(message);
    }
  }
}

export function closeSheet(sheetId: string): void {
  const session = sessions.get(sheetId);
  if (!session) {
    return;
  }
  const token = {};
  session.closeToken = token;
  const timer = setTimeout(() => {
    if (session.closeToken !== token) {
      return;
    }
    session.destroy();
  }, 0);
  session.cancelClose = () => {
    session.closeToken = null;
    clearTimeout(timer);
  };
}

export function subscribeSheetToast(sheetId: string, listener: (message: string) => void): () => void {
  const session = sessions.get(sheetId);
  if (!session) {
    return () => {};
  }
  session.toastListeners.add(listener);
  return () => {
    session.toastListeners.delete(listener);
  };
}

export function useSheetSession(sheetId: string, userId: string): StoreApi<SheetState> | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      openSheet(sheetId, { userId });
      const timer = setTimeout(onStoreChange, 0);
      return () => {
        clearTimeout(timer);
        closeSheet(sheetId);
      };
    },
    [sheetId, userId],
  );
  const getSnapshot = useCallback(() => sessions.get(sheetId)?.store ?? null, [sheetId]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerStore);
}

export function useSheetDispatch(): SheetDispatch {
  const store = useSheetStore();
  const sheetId = useStore(store, (state) => state.sheet.id);
  const session = sessions.get(sheetId);
  return session?.dispatch ?? noopDispatch;
}

function getServerStore(): null {
  return null;
}

function noopDispatch(): void {}

function localOf(state: SheetState): LocalSheetState {
  return {
    columns: state.columns,
    columnOrder: state.columnOrder,
    rows: state.rows,
    rowOrder: state.rowOrder,
    groups: state.groups,
    groupOrder: state.groupOrder,
  };
}

function localFields(state: LocalSheetState): Pick<
  SheetState,
  "columns" | "columnOrder" | "rows" | "rowOrder" | "groups" | "groupOrder"
> {
  return {
    columns: state.columns,
    columnOrder: state.columnOrder,
    rows: state.rows,
    rowOrder: state.rowOrder,
    groups: state.groups,
    groupOrder: state.groupOrder,
  };
}

function snapshotState(snapshot: ClientSnapshot): LocalSheetState {
  const columns: Record<string, LocalColumn> = {};
  const columnOrder: string[] = [];
  for (const column of snapshot.columns) {
    columns[column.id] = {
      id: column.id,
      name: column.name,
      type: column.type,
      position: column.position,
      width: column.width,
      settings: { ...(column.settings ?? {}) },
    };
    columnOrder.push(column.id);
  }
  const groups: Record<string, LocalSheetState["groups"][string]> = {};
  const groupOrder: string[] = [];
  for (const group of snapshot.groups) {
    groups[group.id] = {
      id: group.id,
      name: group.name,
      color: group.color,
      position: group.position,
    };
    groupOrder.push(group.id);
  }
  const rows: Record<string, LocalRow> = {};
  const rowOrder: string[] = [];
  for (const row of snapshot.rows) {
    rows[row.id] = {
      id: row.id,
      position: row.position,
      data: { ...(row.data ?? {}) },
      groupId: row.groupId,
      itemNumber: row.itemNumber,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    };
    rowOrder.push(row.id);
  }
  return { columns, columnOrder, rows, rowOrder, groups, groupOrder };
}

function cellsOf(op: SheetOp): CellChange[] {
  if (op.type === "cell.set") {
    return [{ rowId: op.payload.rowId, columnId: op.payload.columnId, value: op.payload.value }];
  }
  if (op.type === "cells.setMany") {
    return op.payload.cells.map((cell) => ({
      rowId: cell.rowId,
      columnId: cell.columnId,
      value: cell.value,
    }));
  }
  return [];
}

function touches(pending: Map<string, PendingOp>, rowId: string, columnId: string): boolean {
  for (const item of pending.values()) {
    if (item.op.type === "cell.set" && item.op.payload.rowId === rowId && item.op.payload.columnId === columnId) {
      return true;
    }
    if (
      item.op.type === "cells.setMany" &&
      item.op.payload.cells.some((cell) => cell.rowId === rowId && cell.columnId === columnId)
    ) {
      return true;
    }
  }
  return false;
}

function cellKey(rowId: string, columnId: string): string {
  return `${rowId}:${columnId}`;
}

function wire(op: SheetOp): SheetOp {
  return {
    clientOpId: op.clientOpId,
    sheetId: op.sheetId,
    type: op.type,
    payload: op.payload,
  } as SheetOp;
}

interface ClientSnapshot {
  sheet: { id: string; name: string; direction: SheetDirection; version: number };
  groups: Array<{
    id: string;
    name: string;
    color: string;
    position: string;
  }>;
  columns: Array<{
    id: string;
    name: string;
    type: LocalColumn["type"];
    position: string;
    width: number;
    settings?: Record<string, JsonValue>;
  }>;
  rows: Array<{
    id: string;
    position: string;
    data?: Record<string, JsonValue>;
    groupId: string | null;
    itemNumber: number;
    createdBy: string | null;
    createdAt: string;
    updatedBy: string | null;
    updatedAt: string;
  }>;
}

type JoinAck =
  | { ok: true; snapshot: ClientSnapshot }
  | { ok: false; message?: string };

function emitAck(
  socket: ReturnType<typeof getSocket>,
  event: string,
  payload: unknown,
): Promise<JoinAck | null> {
  return new Promise((resolve) => {
    socket.timeout(JOIN_ACK_MS).emit(event, payload, (error: Error | null, result?: unknown) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(readJoin(result));
    });
  });
}

function readJoin(value: unknown): JoinAck | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return null;
  }
  if (value.ok !== true) {
    return { ok: false, message: typeof value.message === "string" ? value.message : undefined };
  }
  const snapshot = readSnapshot(value.snapshot);
  return snapshot ? { ok: true, snapshot } : null;
}

function readSnapshot(value: unknown): ClientSnapshot | null {
  if (!isRecord(value) || !isRecord(value.sheet) || !Array.isArray(value.columns) || !Array.isArray(value.rows)) {
    return null;
  }
  const sheet = value.sheet;
  if (typeof sheet.id !== "string" || typeof sheet.name !== "string") {
    return null;
  }
  const direction: SheetDirection = sheet.direction === "ltr" ? "ltr" : "rtl";
  const groups: ClientSnapshot["groups"] = [];
  for (const group of Array.isArray(value.groups) ? value.groups : []) {
    if (!isRecord(group) || typeof group.id !== "string" || typeof group.name !== "string") {
      continue;
    }
    if (typeof group.color !== "string" || typeof group.position !== "string") {
      continue;
    }
    groups.push({
      id: group.id,
      name: group.name,
      color: group.color,
      position: group.position,
    });
  }
  const columns: ClientSnapshot["columns"] = [];
  for (const column of value.columns) {
    if (!isRecord(column) || typeof column.id !== "string" || typeof column.name !== "string") {
      continue;
    }
    if (typeof column.type !== "string" || typeof column.position !== "string") {
      continue;
    }
    columns.push({
      id: column.id,
      name: column.name,
      type: column.type as LocalColumn["type"],
      position: column.position,
      width: typeof column.width === "number" ? column.width : 180,
      settings: isRecord(column.settings) ? (column.settings as Record<string, JsonValue>) : {},
    });
  }
  const rows: ClientSnapshot["rows"] = isRecord(value.packed) && Array.isArray(value.packed.rows) ? unpackRows(value.packed as unknown as PackedRows) : [];
  for (const row of value.rows) {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.position !== "string") {
      continue;
    }
    rows.push({
      id: row.id,
      position: row.position,
      data: isRecord(row.data) ? (row.data as Record<string, JsonValue>) : {},
      groupId: typeof row.groupId === "string" ? row.groupId : null,
      itemNumber: typeof row.itemNumber === "number" ? row.itemNumber : 0,
      createdBy: typeof row.createdBy === "string" ? row.createdBy : null,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
      updatedBy: typeof row.updatedBy === "string" ? row.updatedBy : null,
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
    });
  }
  return {
    sheet: {
      id: sheet.id,
      name: sheet.name,
      direction,
      version: typeof sheet.version === "number" ? sheet.version : Number(sheet.version) || 0,
    },
    groups,
    columns,
    rows,
  };
}

function readApplied(value: unknown): AppliedEvent | null {
  if (!isRecord(value) || typeof value.version !== "number" || !isRecord(value.op)) {
    return null;
  }
  const op = value.op as unknown as SheetOp;
  if (typeof op.type !== "string" || typeof op.sheetId !== "string" || typeof op.clientOpId !== "string") {
    return null;
  }
  return { op, version: value.version, clientOpId: op.clientOpId };
}

function isAck(value: unknown): value is { ok: true; version: number } | { ok: false; code: string; message: string } {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return false;
  }
  if (value.ok === true) {
    return typeof value.version === "number";
  }
  return typeof value.code === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function flushDetached(items: PendingOp[]): void {
  const socket = getSocket();
  const queue = [...items];
  const sendNext = (): void => {
    const item = queue[0];
    if (!item) {
      return;
    }
    if (!socket.connected) {
      socket.once("connect", sendNext);
      return;
    }
    socket.timeout(ACK_MS).emit("op", wire(item.op), (error: Error | null, result?: unknown) => {
      if (error || !isAck(result)) {
        socket.once("connect", sendNext);
        return;
      }
      if (!result.ok && result.code === "rate_limited") {
        setTimeout(sendNext, RATE_MS);
        return;
      }
      queue.shift();
      sendNext();
    });
  };
  sendNext();
}
