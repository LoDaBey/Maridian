import type { Socket } from "socket.io";
import { z } from "zod";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { applyOp, type ApplyResult } from "@/lib/sheets/apply-op";
import { loadSnapshot } from "@/lib/sheets/snapshot";
import { userCanAccessSheet } from "@/lib/sheets/workbook-access";
import {
  joinSheetPresence,
  leaveSheetPresence,
  listWorkspacePresence,
  presenceUpdateSchema,
  updateSheetPresence,
  type PresenceView,
} from "./presence";

const OP_RATE = 30;

const joinSchema = z.object({
  sheetId: z.uuid(),
});

interface TokenBucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new WeakMap<Socket, TokenBucket>();

export type SheetAck =
  | ApplyResult
  | { ok: true }
  | { ok: false; code: "rate_limited" | "error" | "forbidden" | "not_found" | "invalid"; message: string }
  | {
      ok: true;
      snapshot: NonNullable<Awaited<ReturnType<typeof loadSnapshot>>>;
      presence: PresenceView[];
    };

export function registerSheetHandlers(socket: Socket): void {
  for (const entry of listWorkspacePresence()) {
    socket.emit("workspace:presence", entry);
  }

  socket.on("presence:update", (payload: unknown) => {
    const parsed = presenceUpdateSchema.safeParse(payload);
    const user = currentUser(socket);
    if (!parsed.success || !user) {
      return;
    }
    if (!socket.rooms.has(`sheet:${parsed.data.sheetId}`)) {
      return;
    }
    updateSheetPresence(socket.id, user, parsed.data);
  });

  socket.on("sheet:join", (payload: unknown, ack?: unknown) => {
    void handle(ack, async () => {
      const parsed = joinSchema.safeParse(payload);
      if (!parsed.success) {
        return { ok: false, code: "invalid", message: "Sheet not found." };
      }
      const user = currentUser(socket);
      if (!user || !can(user.role, "sheet.view")) {
        return { ok: false, code: "forbidden", message: "You don't have permission to do that." };
      }
      if (!(await userCanAccessSheet(user, parsed.data.sheetId))) {
        return { ok: false, code: "forbidden", message: "You don't have access to this sheet." };
      }
      const snapshot = await loadSnapshot(parsed.data.sheetId);
      if (!snapshot) {
        return { ok: false, code: "not_found", message: "Sheet not found." };
      }
      const sheetRooms = [...socket.rooms].filter((room) => room.startsWith("sheet:"));
      for (const room of sheetRooms) {
        leaveSheetPresence(socket.id, room.slice("sheet:".length));
        await socket.leave(room);
      }
      await socket.join(`sheet:${parsed.data.sheetId}`);
      const joined = joinSheetPresence(socket.id, user, parsed.data.sheetId);
      socket.emit("presence:snapshot", {
        sheetId: parsed.data.sheetId,
        self: joined.self,
        others: joined.others,
      });
      return { ok: true, snapshot, presence: joined.others };
    });
  });

  socket.on("sheet:leave", (payload: unknown, ack?: unknown) => {
    void handle(ack, async () => {
      const parsed = joinSchema.safeParse(payload);
      if (!parsed.success) {
        return { ok: false, code: "invalid", message: "Sheet not found." };
      }
      leaveSheetPresence(socket.id, parsed.data.sheetId);
      await socket.leave(`sheet:${parsed.data.sheetId}`);
      return { ok: true };
    });
  });

  socket.on("op", (payload: unknown, ack?: unknown) => {
    void handle(ack, async () => {
      if (!takeToken(socket)) {
        return { ok: false, code: "rate_limited", message: "Too many changes. Try again in a moment." };
      }
      const user = currentUser(socket);
      if (!user) {
        return { ok: false, code: "forbidden", message: "You don't have permission to do that." };
      }
      const result = await applyOp(user, payload);
      if (result.ok) {
        socket.to(`sheet:${result.op.sheetId}`).emit("op:applied", {
          op: result.op,
          version: result.version,
          userId: user.id,
          clientOpId: result.op.clientOpId,
          at: new Date().toISOString(),
        });
        for (const notification of result.notifications ?? []) {
          socket.nsp.to(`user:${notification.userId}`).emit("notification:created", notification);
        }
      }
      return result;
    });
  });
}

function currentUser(socket: Socket): SessionUser | null {
  const user = socket.data.user as SessionUser | undefined;
  if (!user?.id || !user.role) {
    return null;
  }
  return user;
}

function takeToken(socket: Socket): boolean {
  const now = Date.now();
  const bucket = buckets.get(socket) ?? { tokens: OP_RATE, updatedAt: now };
  const refilled = Math.min(OP_RATE, bucket.tokens + ((now - bucket.updatedAt) / 1000) * OP_RATE);
  if (refilled < 1) {
    buckets.set(socket, { tokens: refilled, updatedAt: now });
    return false;
  }
  buckets.set(socket, { tokens: refilled - 1, updatedAt: now });
  return true;
}

async function handle(ack: unknown, run: () => Promise<SheetAck>): Promise<void> {
  const respond = typeof ack === "function" ? (ack as (result: SheetAck) => void) : null;
  try {
    const result = await run();
    respond?.(result);
  } catch (error) {
    console.error("sheet handler failed", error instanceof Error ? error.name : "error");
    respond?.({ ok: false, code: "error", message: "Something went wrong." });
  }
}
