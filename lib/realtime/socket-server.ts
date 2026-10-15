import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { validateSessionToken, type SessionUser } from "../auth/session";
import { queryOne } from "../db";
import { env } from "../env";
import { leaveSocketPresence } from "./presence";
import { registerSheetHandlers } from "./sheet-handlers";

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = part.slice(0, separator).trim();
    if (key !== name) {
      continue;
    }

    return decodeURIComponent(part.slice(separator + 1).trim());
  }

  return null;
}

const globalForIo = globalThis as typeof globalThis & {
  __io?: Server;
};

function allowsSocketOrigin(origin: string | undefined): boolean {
  if (!origin || origin === env.APP_URL) {
    return true;
  }

  try {
    const app = new URL(env.APP_URL);
    const request = new URL(origin);
    const localHosts = new Set(["localhost", "127.0.0.1"]);
    return (
      request.protocol === app.protocol &&
      request.port === app.port &&
      localHosts.has(request.hostname) &&
      localHosts.has(app.hostname)
    );
  } catch {
    return false;
  }
}

export function attachSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: "/socket.io",
    allowRequest: (req, callback) => {
      const originHeader = req.headers.origin;
      const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
      if (!allowsSocketOrigin(origin)) {
        callback("origin", false);
        return;
      }
      callback(null, true);
    },
    cors: {
      origin: (origin, callback) => {
        callback(null, allowsSocketOrigin(origin));
      },
      credentials: true,
    },
    // Engine.IO otherwise closes upgrade sockets it does not own, which
    // drops Next.js hot reload on this same HTTP server.
    destroyUpgrade: false,
  });

  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      const header = Array.isArray(cookieHeader)
        ? cookieHeader.join("; ")
        : cookieHeader;
      const token = readCookie(header, "monitor_session");

      if (!token) {
        next(new Error("unauthorized"));
        return;
      }

      const session = await validateSessionToken(token);

      if (!session || session.user.mustChangePassword) {
        next(new Error("unauthorized"));
        return;
      }

      socket.data.user = session.user;
      await socket.join(`user:${session.user.id}`);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.engine.on("connection_error", (error: { code: number; message: string }) => {
    console.error("socket connection error", error.code, error.message);
  });

  io.on("connection", (socket) => {
    void socket.join("workspace");
    registerSheetHandlers(socket);
    console.log(`socket connected: ${socket.id}`);
    socket.on("error", (error: unknown) => {
      console.error("socket error", error instanceof Error ? error.message : "unknown socket error");
    });
    socket.on("disconnect", () => {
      leaveSocketPresence(socket.id);
      console.log(`socket disconnected: ${socket.id}`);
    });
  });

  globalForIo.__io = io;
  return io;
}

export function broadcastSheetsChanged(): void {
  getIO().to("workspace").emit("sheets:changed");
}

export function broadcastSheetMeta(meta: {
  id: string;
  name: string;
  direction: "rtl" | "ltr";
  archived: boolean;
}): void {
  getIO().to(`sheet:${meta.id}`).emit("sheet:meta", meta);
}

export function getIO(): Server {
  const io = globalForIo.__io;

  if (!io) {
    throw new Error("Socket.IO server is not attached");
  }

  return io;
}

interface PublicUserRow {
  id: string;
  email: string;
  full_name: string;
  role: SessionUser["role"];
  avatar_color: string;
  must_change_password: boolean;
}

export function kickUser(userId: string): void {
  const room = `user:${userId}`;
  const io = getIO();
  io.to(room).emit("session:revoked");
  io.in(room).disconnectSockets(true);
}

export async function refreshUserSockets(userId: string): Promise<void> {
  const row = await queryOne<PublicUserRow>(
    `SELECT id, email, full_name, role, avatar_color, must_change_password
     FROM monitor_users
     WHERE id = $1`,
    [userId],
  );

  if (!row) {
    return;
  }

  const profile: SessionUser = {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    avatarColor: row.avatar_color,
    mustChangePassword: row.must_change_password,
  };
  const room = `user:${userId}`;
  const io = getIO();
  const sockets = await io.in(room).fetchSockets();

  for (const socket of sockets) {
    socket.data.user = profile;
  }

  io.to(room).emit("user:updated", {
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    role: profile.role,
    avatarColor: profile.avatarColor,
  });
}
