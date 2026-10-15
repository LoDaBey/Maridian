import { z } from "zod";
import type { SessionUser } from "@/lib/auth/session";

const MIN_GAP_MS = 1000 / 15;
const WORKSPACE_DEBOUNCE_MS = 300;

export const presenceUpdateSchema = z.object({
  sheetId: z.uuid(),
  activeCell: z
    .object({
      rowId: z.uuid(),
      columnId: z.uuid(),
    })
    .nullable(),
  selection: z
    .object({
      startRow: z.uuid(),
      endRow: z.uuid(),
      startCol: z.uuid(),
      endCol: z.uuid(),
    })
    .nullable()
    .optional(),
  editing: z.boolean(),
  idle: z.boolean(),
});

export type PresenceUpdate = z.infer<typeof presenceUpdateSchema>;

export interface Presence {
  userId: string;
  fullName: string;
  avatarColor: string;
  role: SessionUser["role"];
  activeCell: { rowId: string; columnId: string } | null;
  selection: { startRow: string; endRow: string; startCol: string; endCol: string } | null;
  editing: boolean;
  idle: boolean;
  updatedAt: number;
}

export interface PresenceView extends Presence {
  socketId: string;
}

export interface WorkspaceUser {
  userId: string;
  fullName: string;
  avatarColor: string;
}

interface ThrottleSlot {
  lastSent: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface PresenceGlobal {
  __presenceSheets?: Map<string, Map<string, Presence>>;
  __presenceSocketSheet?: Map<string, string>;
  __presenceThrottle?: Map<string, ThrottleSlot>;
  __workspaceTimers?: Map<string, ReturnType<typeof setTimeout>>;
}

interface RoomEmitter {
  to(room: string): {
    except(socketId: string): { emit(event: string, payload: unknown): void };
    emit(event: string, payload: unknown): void;
  };
}

function registry(): PresenceGlobal {
  return globalThis as typeof globalThis & PresenceGlobal;
}

function sheets(): Map<string, Map<string, Presence>> {
  const state = registry();
  state.__presenceSheets ??= new Map();
  return state.__presenceSheets;
}

function socketSheet(): Map<string, string> {
  const state = registry();
  state.__presenceSocketSheet ??= new Map();
  return state.__presenceSocketSheet;
}

function throttles(): Map<string, ThrottleSlot> {
  const state = registry();
  state.__presenceThrottle ??= new Map();
  return state.__presenceThrottle;
}

function workspaceTimers(): Map<string, ReturnType<typeof setTimeout>> {
  const state = registry();
  state.__workspaceTimers ??= new Map();
  return state.__workspaceTimers;
}

function emitter(): RoomEmitter | null {
  return (globalThis as typeof globalThis & { __io?: RoomEmitter }).__io ?? null;
}

function view(socketId: string, presence: Presence): PresenceView {
  return { socketId, ...presence };
}

function roomOf(sheetId: string): Map<string, Presence> {
  const existing = sheets().get(sheetId);
  if (existing) {
    return existing;
  }
  const created = new Map<string, Presence>();
  sheets().set(sheetId, created);
  return created;
}

export function workspaceUsers(sheetId: string): WorkspaceUser[] {
  const room = sheets().get(sheetId);
  if (!room) {
    return [];
  }
  const byUser = new Map<string, WorkspaceUser>();
  for (const presence of room.values()) {
    if (!byUser.has(presence.userId)) {
      byUser.set(presence.userId, {
        userId: presence.userId,
        fullName: presence.fullName,
        avatarColor: presence.avatarColor,
      });
    }
  }
  return [...byUser.values()];
}

export function listWorkspacePresence(): Array<{ sheetId: string; users: WorkspaceUser[] }> {
  return [...sheets().keys()].map((sheetId) => ({
    sheetId,
    users: workspaceUsers(sheetId),
  }));
}

function scheduleWorkspace(sheetId: string): void {
  const timers = workspaceTimers();
  const existing = timers.get(sheetId);
  if (existing) {
    clearTimeout(existing);
  }
  timers.set(
    sheetId,
    setTimeout(() => {
      timers.delete(sheetId);
      emitter()?.to("workspace").emit("workspace:presence", {
        sheetId,
        users: workspaceUsers(sheetId),
      });
    }, WORKSPACE_DEBOUNCE_MS),
  );
}

function broadcastUpdate(sheetId: string, socketId: string): void {
  const presence = sheets().get(sheetId)?.get(socketId);
  if (!presence) {
    return;
  }
  emitter()?.to(`sheet:${sheetId}`).except(socketId).emit("presence:update", view(socketId, presence));
}

export function joinSheetPresence(socketId: string, user: SessionUser, sheetId: string): {
  self: PresenceView;
  others: PresenceView[];
} {
  const previous = socketSheet().get(socketId);
  if (previous && previous !== sheetId) {
    leaveSheetPresence(socketId, previous);
  }
  const room = roomOf(sheetId);
  const others = [...room.entries()]
    .filter(([id]) => id !== socketId)
    .map(([id, presence]) => view(id, presence));
  const presence: Presence = {
    userId: user.id,
    fullName: user.fullName,
    avatarColor: user.avatarColor,
    role: user.role,
    activeCell: null,
    selection: null,
    editing: false,
    idle: false,
    updatedAt: Date.now(),
  };
  room.set(socketId, presence);
  socketSheet().set(socketId, sheetId);
  broadcastUpdate(sheetId, socketId);
  scheduleWorkspace(sheetId);
  return { self: view(socketId, presence), others };
}

export function updateSheetPresence(socketId: string, user: SessionUser, update: PresenceUpdate): void {
  if (socketSheet().get(socketId) !== update.sheetId) {
    return;
  }
  const room = sheets().get(update.sheetId);
  if (!room) {
    return;
  }
  room.set(socketId, {
    userId: user.id,
    fullName: user.fullName,
    avatarColor: user.avatarColor,
    role: user.role,
    activeCell: update.activeCell,
    selection: update.selection ?? null,
    editing: update.editing,
    idle: update.idle,
    updatedAt: Date.now(),
  });
  const slots = throttles();
  const slot = slots.get(socketId) ?? { lastSent: 0, timer: null };
  const now = Date.now();
  if (now - slot.lastSent >= MIN_GAP_MS) {
    slot.lastSent = now;
    if (slot.timer) {
      clearTimeout(slot.timer);
      slot.timer = null;
    }
    slots.set(socketId, slot);
    broadcastUpdate(update.sheetId, socketId);
    return;
  }
  if (!slot.timer) {
    slot.timer = setTimeout(() => {
      slot.timer = null;
      slot.lastSent = Date.now();
      broadcastUpdate(update.sheetId, socketId);
    }, MIN_GAP_MS - (now - slot.lastSent));
  }
  slots.set(socketId, slot);
}

export function leaveSheetPresence(socketId: string, sheetId: string): void {
  const room = sheets().get(sheetId);
  if (!room?.delete(socketId)) {
    return;
  }
  if (room.size === 0) {
    sheets().delete(sheetId);
  }
  if (socketSheet().get(socketId) === sheetId) {
    socketSheet().delete(socketId);
  }
  const slot = throttles().get(socketId);
  if (slot?.timer) {
    clearTimeout(slot.timer);
  }
  throttles().delete(socketId);
  emitter()?.to(`sheet:${sheetId}`).emit("presence:leave", { socketId });
  scheduleWorkspace(sheetId);
}

export function leaveSocketPresence(socketId: string): void {
  const sheetId = socketSheet().get(socketId);
  if (!sheetId) {
    return;
  }
  leaveSheetPresence(socketId, sheetId);
}
