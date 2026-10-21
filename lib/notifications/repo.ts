import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import type { NotificationItem, NotificationType } from "@/lib/db-types";

export interface PendingNotification {
  userId: string;
  type: NotificationType;
  sheetId: string;
  rowId: string | null;
  actorId: string | null;
  payload: Record<string, unknown>;
}

export type CreatedNotification = NotificationItem;

export async function insertNotifications(
  client: PoolClient,
  items: PendingNotification[],
): Promise<CreatedNotification[]> {
  const unique = dedupe(items);
  if (unique.length === 0) {
    return [];
  }
  const created: CreatedNotification[] = [];
  for (const item of unique) {
    const result = await client.query<{
      id: string;
      user_id: string;
      type: NotificationType;
      sheet_id: string;
      row_id: string | null;
      actor_id: string | null;
      payload: Record<string, unknown>;
      created_at: Date;
      read_at: Date | null;
      actor_name: string | null;
      actor_color: string | null;
      sheet_name: string | null;
    }>(
      `INSERT INTO monitor_notifications (user_id, type, sheet_id, row_id, actor_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, user_id, type, sheet_id, row_id, actor_id, payload, created_at, read_at,
         (SELECT full_name FROM monitor_users WHERE id = $5) AS actor_name,
         (SELECT avatar_color FROM monitor_users WHERE id = $5) AS actor_color,
         (SELECT name FROM monitor_sheets WHERE id = $3) AS sheet_name`,
      [item.userId, item.type, item.sheetId, item.rowId, item.actorId, JSON.stringify(item.payload)],
    );
    const row = result.rows[0];
    if (row) {
      created.push(mapNotification(row));
    }
  }
  return created;
}

export async function listNotifications(userId: string, limit = 40): Promise<NotificationItem[]> {
  const rows = await query<{
    id: string;
    user_id: string;
    type: NotificationType;
    sheet_id: string;
    row_id: string | null;
    actor_id: string | null;
    payload: Record<string, unknown>;
    created_at: Date;
    read_at: Date | null;
    actor_name: string | null;
    actor_color: string | null;
    sheet_name: string | null;
  }>(
    `SELECT n.id, n.user_id, n.type, n.sheet_id, n.row_id, n.actor_id, n.payload, n.created_at, n.read_at,
            u.full_name AS actor_name, u.avatar_color AS actor_color, s.name AS sheet_name
     FROM monitor_notifications n
     LEFT JOIN monitor_users u ON u.id = n.actor_id
     LEFT JOIN monitor_sheets s ON s.id = n.sheet_id
     WHERE n.user_id = $1
     ORDER BY n.created_at DESC
     LIMIT $2`,
    [userId, Math.min(100, Math.max(1, limit))],
  );
  return rows.map(mapNotification);
}

export async function unreadCount(userId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM monitor_notifications
     WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function markNotificationsRead(userId: string, ids: string[] | null): Promise<void> {
  if (ids && ids.length === 0) {
    return;
  }
  if (ids) {
    await query(
      `UPDATE monitor_notifications
       SET read_at = now()
       WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL`,
      [userId, ids],
    );
    return;
  }
  await query(
    `UPDATE monitor_notifications
     SET read_at = now()
     WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
}

function mapNotification(row: {
  id: string;
  user_id: string;
  type: NotificationType;
  sheet_id: string;
  row_id: string | null;
  actor_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
  read_at: Date | null;
  actor_name: string | null;
  actor_color: string | null;
  sheet_name: string | null;
}): CreatedNotification {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    sheetId: row.sheet_id,
    rowId: row.row_id,
    actorId: row.actor_id,
    actorName: row.actor_name ?? "Someone",
    actorColor: row.actor_color ?? "#0073ea",
    sheetName: row.sheet_name ?? "Sheet",
    excerpt: excerptOf(row.type, row.payload),
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at ? row.read_at.toISOString() : null,
  };
}

function excerptOf(type: NotificationType, payload: Record<string, unknown>): string {
  const excerpt = typeof payload.excerpt === "string" ? payload.excerpt : "";
  if (excerpt) {
    return excerpt;
  }
  if (type === "mention") {
    return "mentioned you";
  }
  if (type === "assign") {
    return "assigned you";
  }
  if (type === "reply") {
    return "replied to your update";
  }
  if (type === "due") {
    return "has a due date coming up";
  }
  if (type === "share") {
    return "shared a sheet with you";
  }
  return "changed a status";
}

function dedupe(items: PendingNotification[]): PendingNotification[] {
  const seen = new Set<string>();
  const next: PendingNotification[] = [];
  for (const item of items) {
    if (item.actorId && item.userId === item.actorId && item.type !== "due") {
      continue;
    }
    const key = `${item.userId}:${item.type}:${item.sheetId}:${item.rowId ?? ""}:${String(item.payload.columnId ?? "")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(item);
  }
  return next;
}
