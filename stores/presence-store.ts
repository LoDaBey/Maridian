"use client";

import { useSyncExternalStore } from "react";
import { getSocket } from "@/lib/realtime/client";
import type { PresenceView, WorkspaceUser } from "@/lib/realtime/presence";

const IDLE_MS = 5 * 60 * 1000;
const EMIT_GAP_MS = 100;

export interface PresenceTag {
  socketId: string;
  name: string;
  color: string;
  editing: boolean;
}

export interface CellPresence {
  tags: PresenceTag[];
  fills: string[];
  editingName: string | null;
}

export interface PresenceDots {
  colors: string[];
  extra: number;
}

export interface PresencePerson {
  socketId: string;
  userId: string;
  fullName: string;
  avatarColor: string;
  role: PresenceView["role"];
  activeCell: PresenceView["activeCell"];
  editing: boolean;
  idle: boolean;
  you: boolean;
}

const EMPTY_CELL: CellPresence = { tags: [], fills: [], editingName: null };
const EMPTY_DOTS: PresenceDots = { colors: [], extra: 0 };
const EMPTY_USERS: WorkspaceUser[] = [];
const EMPTY_PEOPLE: PresencePerson[] = [];

const bySocket = new Map<string, PresenceView>();
let selfView: PresenceView | null = null;
let rowIds: string[] = [];
let columnIds: string[] = [];

const cellListeners = new Map<string, Set<() => void>>();
const cellSnapshots = new Map<string, CellPresence>();
const rowListeners = new Map<string, Set<() => void>>();
const rowSnapshots = new Map<string, PresenceDots>();
const columnListeners = new Map<string, Set<() => void>>();
const columnSnapshots = new Map<string, PresenceDots>();
const peopleListeners = new Set<() => void>();
let peopleSnapshot: PresencePerson[] = EMPTY_PEOPLE;

const workspace = new Map<string, WorkspaceUser[]>();
const workspaceListeners = new Map<string, Set<() => void>>();
const workspaceSnapshots = new Map<string, WorkspaceUser[]>();

let listening = false;
let resend: (() => void) | null = null;
let follow: ((rowId: string, columnId: string) => void) | null = null;
let lastEmit = 0;
let trailing: ReturnType<typeof setTimeout> | null = null;
let pendingPayload: Record<string, unknown> | null = null;
let idle = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function notify(listeners: Set<() => void> | undefined): void {
  if (!listeners) {
    return;
  }
  for (const listener of listeners) {
    listener();
  }
}

function cellKey(rowId: string, columnId: string): string {
  return `${rowId}:${columnId}`;
}

function indexOf(ids: string[], id: string): number {
  return ids.indexOf(id);
}

function selectionCovers(
  selection: PresenceView["selection"],
  rowId: string,
  columnId: string,
): boolean {
  if (!selection) {
    return false;
  }
  const startRow = indexOf(rowIds, selection.startRow);
  const endRow = indexOf(rowIds, selection.endRow);
  const startColumn = indexOf(columnIds, selection.startCol);
  const endColumn = indexOf(columnIds, selection.endCol);
  const row = indexOf(rowIds, rowId);
  const column = indexOf(columnIds, columnId);
  if (startRow < 0 || endRow < 0 || startColumn < 0 || endColumn < 0 || row < 0 || column < 0) {
    return false;
  }
  return (
    row >= Math.min(startRow, endRow) &&
    row <= Math.max(startRow, endRow) &&
    column >= Math.min(startColumn, endColumn) &&
    column <= Math.max(startColumn, endColumn)
  );
}

function rowCovered(selection: PresenceView["selection"], rowId: string): boolean {
  if (!selection) {
    return false;
  }
  const startRow = indexOf(rowIds, selection.startRow);
  const endRow = indexOf(rowIds, selection.endRow);
  const row = indexOf(rowIds, rowId);
  if (startRow < 0 || endRow < 0 || row < 0) {
    return false;
  }
  return row >= Math.min(startRow, endRow) && row <= Math.max(startRow, endRow);
}

function columnCovered(selection: PresenceView["selection"], columnId: string): boolean {
  if (!selection) {
    return false;
  }
  const startColumn = indexOf(columnIds, selection.startCol);
  const endColumn = indexOf(columnIds, selection.endCol);
  const column = indexOf(columnIds, columnId);
  if (startColumn < 0 || endColumn < 0 || column < 0) {
    return false;
  }
  return column >= Math.min(startColumn, endColumn) && column <= Math.max(startColumn, endColumn);
}

function isSelf(socketId: string): boolean {
  return selfView?.socketId === socketId;
}

function computeCell(rowId: string, columnId: string): CellPresence {
  const tags: PresenceTag[] = [];
  const fills: string[] = [];
  let editingName: string | null = null;
  for (const presence of bySocket.values()) {
    if (isSelf(presence.socketId)) {
      continue;
    }
    if (presence.activeCell?.rowId === rowId && presence.activeCell.columnId === columnId) {
      tags.push({
        socketId: presence.socketId,
        name: presence.fullName,
        color: presence.avatarColor,
        editing: presence.editing,
      });
      if (presence.editing && !editingName) {
        editingName = presence.fullName;
      }
    }
    if (selectionCovers(presence.selection, rowId, columnId)) {
      fills.push(presence.avatarColor);
    }
  }
  if (tags.length === 0 && fills.length === 0 && !editingName) {
    return EMPTY_CELL;
  }
  return { tags, fills, editingName };
}

function computeDots(kind: "row" | "column", id: string): PresenceDots {
  const colors: string[] = [];
  const seen = new Set<string>();
  for (const presence of bySocket.values()) {
    if (isSelf(presence.socketId) || seen.has(presence.userId)) {
      continue;
    }
    const onRow = kind === "row" && (presence.activeCell?.rowId === id || rowCovered(presence.selection, id));
    const onColumn = kind === "column" && (presence.activeCell?.columnId === id || columnCovered(presence.selection, id));
    if (!onRow && !onColumn) {
      continue;
    }
    seen.add(presence.userId);
    colors.push(presence.avatarColor);
  }
  if (colors.length === 0) {
    return EMPTY_DOTS;
  }
  return { colors: colors.slice(0, 3), extra: Math.max(0, colors.length - 3) };
}

function computePeople(): PresencePerson[] {
  const others = new Map<string, PresencePerson>();
  for (const presence of bySocket.values()) {
    if (selfView && presence.userId === selfView.userId) {
      continue;
    }
    const existing = others.get(presence.userId);
    if (existing && existing.socketId !== presence.socketId) {
      const current = bySocket.get(existing.socketId);
      if (current && current.updatedAt > presence.updatedAt) {
        continue;
      }
    }
    others.set(presence.userId, {
      socketId: presence.socketId,
      userId: presence.userId,
      fullName: presence.fullName,
      avatarColor: presence.avatarColor,
      role: presence.role,
      activeCell: presence.activeCell,
      editing: presence.editing,
      idle: presence.idle,
      you: false,
    });
  }
  const people = [...others.values()];
  if (selfView) {
    people.push({
      socketId: selfView.socketId,
      userId: selfView.userId,
      fullName: selfView.fullName,
      avatarColor: selfView.avatarColor,
      role: selfView.role,
      activeCell: selfView.activeCell,
      editing: selfView.editing,
      idle: selfView.idle,
      you: true,
    });
  }
  return people.length === 0 ? EMPTY_PEOPLE : people;
}

function sameTags(left: PresenceTag[], right: PresenceTag[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((tag, index) => {
    const other = right[index];
    return other && tag.socketId === other.socketId && tag.name === other.name && tag.color === other.color && tag.editing === other.editing;
  });
}

function refreshViews(): void {
  for (const [key, listeners] of cellListeners) {
    const split = key.indexOf(":");
    const next = computeCell(key.slice(0, split), key.slice(split + 1));
    const current = cellSnapshots.get(key) ?? EMPTY_CELL;
    if (
      next !== current &&
      (next.editingName !== current.editingName || !sameTags(next.tags, current.tags) || next.fills.join() !== current.fills.join())
    ) {
      cellSnapshots.set(key, next);
      notify(listeners);
    }
  }
  for (const [rowId, listeners] of rowListeners) {
    const next = computeDots("row", rowId);
    const current = rowSnapshots.get(rowId) ?? EMPTY_DOTS;
    if (next.extra !== current.extra || next.colors.join() !== current.colors.join()) {
      rowSnapshots.set(rowId, next);
      notify(listeners);
    }
  }
  for (const [columnId, listeners] of columnListeners) {
    const next = computeDots("column", columnId);
    const current = columnSnapshots.get(columnId) ?? EMPTY_DOTS;
    if (next.extra !== current.extra || next.colors.join() !== current.colors.join()) {
      columnSnapshots.set(columnId, next);
      notify(listeners);
    }
  }
  const nextPeople = computePeople();
  if (nextPeople !== peopleSnapshot) {
    peopleSnapshot = nextPeople;
    notify(peopleListeners);
  }
}

function isView(value: unknown): value is PresenceView {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as PresenceView;
  return typeof record.socketId === "string" && typeof record.userId === "string" && typeof record.fullName === "string";
}

function applyRemote(presence: PresenceView): void {
  if (selfView && presence.socketId === selfView.socketId) {
    selfView = presence;
  }
  bySocket.set(presence.socketId, presence);
  refreshViews();
}

function ensureListening(): void {
  if (listening || typeof window === "undefined") {
    return;
  }
  listening = true;
  const socket = getSocket();
  socket.on("presence:snapshot", (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const record = payload as { self?: unknown; others?: unknown };
    bySocket.clear();
    selfView = isView(record.self) ? record.self : null;
    if (selfView) {
      bySocket.set(selfView.socketId, selfView);
    }
    if (Array.isArray(record.others)) {
      for (const other of record.others) {
        if (isView(other)) {
          bySocket.set(other.socketId, other);
        }
      }
    }
    refreshViews();
    resend?.();
  });
  socket.on("presence:update", (payload: unknown) => {
    if (isView(payload)) {
      applyRemote(payload);
    }
  });
  socket.on("presence:leave", (payload: unknown) => {
    const socketId = payload && typeof payload === "object" ? (payload as { socketId?: unknown }).socketId : null;
    if (typeof socketId !== "string") {
      return;
    }
    bySocket.delete(socketId);
    if (selfView?.socketId === socketId) {
      selfView = null;
    }
    refreshViews();
  });
  socket.on("workspace:presence", (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const record = payload as { sheetId?: unknown; users?: unknown };
    if (typeof record.sheetId !== "string" || !Array.isArray(record.users)) {
      return;
    }
    const users = record.users.filter(
      (user): user is WorkspaceUser =>
        Boolean(user) &&
        typeof user === "object" &&
        typeof (user as WorkspaceUser).userId === "string" &&
        typeof (user as WorkspaceUser).fullName === "string" &&
        typeof (user as WorkspaceUser).avatarColor === "string",
    );
    const next = users.length === 0 ? EMPTY_USERS : users;
    workspace.set(record.sheetId, next);
    workspaceSnapshots.set(record.sheetId, next);
    notify(workspaceListeners.get(record.sheetId));
  });
}

function subscribeKey(map: Map<string, Set<() => void>>, id: string, listener: () => void): () => void {
  ensureListening();
  const set = map.get(id) ?? new Set();
  set.add(listener);
  map.set(id, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      map.delete(id);
    }
  };
}

export function ensurePresenceListening(): void {
  ensureListening();
}

export function setPresenceAxes(nextRows: string[], nextColumns: string[]): void {
  rowIds = nextRows;
  columnIds = nextColumns;
  refreshViews();
}

export function usePresenceAt(rowId: string, columnId: string): CellPresence {
  const key = cellKey(rowId, columnId);
  return useSyncExternalStore(
    (listener) => subscribeKey(cellListeners, key, listener),
    () => cellSnapshots.get(key) ?? EMPTY_CELL,
    () => EMPTY_CELL,
  );
}

export function usePresenceOnRow(rowId: string): PresenceDots {
  return useSyncExternalStore(
    (listener) => subscribeKey(rowListeners, rowId, listener),
    () => rowSnapshots.get(rowId) ?? EMPTY_DOTS,
    () => EMPTY_DOTS,
  );
}

export function usePresenceOnColumn(columnId: string): PresenceDots {
  return useSyncExternalStore(
    (listener) => subscribeKey(columnListeners, columnId, listener),
    () => columnSnapshots.get(columnId) ?? EMPTY_DOTS,
    () => EMPTY_DOTS,
  );
}

export function usePresencePeople(): PresencePerson[] {
  return useSyncExternalStore(
    (listener) => {
      ensureListening();
      peopleListeners.add(listener);
      return () => peopleListeners.delete(listener);
    },
    () => peopleSnapshot,
    () => EMPTY_PEOPLE,
  );
}

export function useWorkspaceUsers(sheetId: string): WorkspaceUser[] {
  return useSyncExternalStore(
    (listener) => subscribeKey(workspaceListeners, sheetId, listener),
    () => workspaceSnapshots.get(sheetId) ?? workspace.get(sheetId) ?? EMPTY_USERS,
    () => EMPTY_USERS,
  );
}

export function registerPresenceResend(listener: () => void): () => void {
  resend = listener;
  return () => {
    if (resend === listener) {
      resend = null;
    }
  };
}

export function registerPresenceFollow(listener: (rowId: string, columnId: string) => void): () => void {
  follow = listener;
  return () => {
    if (follow === listener) {
      follow = null;
    }
  };
}

export function followPresence(rowId: string, columnId: string): void {
  follow?.(rowId, columnId);
}

export function publishPresence(payload: {
  sheetId: string;
  activeCell: { rowId: string; columnId: string } | null;
  selection: { startRow: string; endRow: string; startCol: string; endCol: string } | null;
  editing: boolean;
}): void {
  ensureListening();
  pendingPayload = { ...payload, idle };
  const now = Date.now();
  if (now - lastEmit >= EMIT_GAP_MS) {
    flushPresence();
  } else if (!trailing) {
    trailing = setTimeout(() => {
      trailing = null;
      flushPresence();
    }, EMIT_GAP_MS - (now - lastEmit));
  }
  if (!idleTimer) {
    notePresenceActivity();
  }
}

function flushPresence(): void {
  if (!pendingPayload) {
    return;
  }
  lastEmit = Date.now();
  getSocket().emit("presence:update", pendingPayload);
  if (selfView) {
    const activeCell = pendingPayload.activeCell as PresenceView["activeCell"];
    const selection = pendingPayload.selection as PresenceView["selection"];
    selfView = {
      ...selfView,
      activeCell: activeCell ?? null,
      selection: selection ?? null,
      editing: pendingPayload.editing === true,
      idle,
      updatedAt: Date.now(),
    };
    bySocket.set(selfView.socketId, selfView);
    refreshViews();
  }
}

export function notePresenceActivity(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(() => {
    idle = true;
    if (pendingPayload) {
      pendingPayload = { ...pendingPayload, idle: true };
      flushPresence();
    }
  }, IDLE_MS);
  if (!idle) {
    return;
  }
  idle = false;
  if (pendingPayload) {
    pendingPayload = { ...pendingPayload, idle: false };
    flushPresence();
  }
}
