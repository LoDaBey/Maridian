import { getIO } from "@/lib/realtime/socket-server";

export function emitToSheet(sheetId: string, event: string, payload: unknown): void {
  try {
    getIO().to(`sheet:${sheetId}`).emit(event, payload);
  } catch {
    // Socket server is not attached in isolated tests.
  }
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  try {
    getIO().to(`user:${userId}`).emit(event, payload);
  } catch {
    // Socket server is not attached in isolated tests.
  }
}
