import { query, tx } from "@/lib/db";
import { insertNotifications } from "@/lib/notifications/repo";
import { emitToUser } from "@/lib/realtime/emit";
import { isDoneLabel, localToday } from "@/lib/sheets/column-meta";

interface DueRow {
  sheet_id: string;
  row_id: string;
  column_id: string;
  due: string;
  created_by: string | null;
  data: Record<string, unknown>;
}

interface StatusColumn {
  id: string;
  settings: { options?: Array<{ id?: string; label?: string }> };
}

export async function sendDueReminders(): Promise<number> {
  const today = localToday();
  const tomorrow = shift(today, 1);
  const rows = await query<DueRow>(
    `SELECT r.sheet_id, r.id AS row_id, c.id AS column_id, r.data ->> c.id::text AS due,
            r.created_by, r.data
     FROM monitor_columns c
     JOIN monitor_rows r ON r.sheet_id = c.sheet_id AND r.deleted_at IS NULL
     WHERE c.deleted_at IS NULL
       AND c.type = 'due_date'
       AND COALESCE((c.settings->>'remind')::boolean, false) = true
       AND r.data ? c.id::text
       AND r.data ->> c.id::text IN ($1, $2)`,
    [today, tomorrow],
  );
  let created = 0;
  for (const row of rows) {
    const statusColumns = await query<StatusColumn>(
      `SELECT id, settings FROM monitor_columns
       WHERE sheet_id = $1 AND type = 'status' AND deleted_at IS NULL`,
      [row.sheet_id],
    );
    if (rowIsDoneFromData(row.data, statusColumns)) {
      continue;
    }
    const recipients = await recipientsFor(row);
    if (recipients.length === 0) {
      continue;
    }
    const already = await query<{ user_id: string }>(
      `SELECT user_id
       FROM monitor_notifications
       WHERE type = 'due' AND sheet_id = $1 AND row_id = $2
         AND created_at > now() - interval '20 hours'
         AND user_id = ANY($3::uuid[])`,
      [row.sheet_id, row.row_id, recipients],
    );
    const skip = new Set(already.map((item) => item.user_id));
    const pending = recipients
      .filter((userId) => !skip.has(userId))
      .map((userId) => ({
        userId,
        type: "due" as const,
        sheetId: row.sheet_id,
        rowId: row.row_id,
        actorId: null,
        payload: {
          columnId: row.column_id,
          excerpt: row.due === today ? "is due today" : "is due tomorrow",
        },
      }));
    if (pending.length === 0) {
      continue;
    }
    const notifications = await tx((client) => insertNotifications(client, pending));
    for (const notification of notifications) {
      emitToUser(notification.userId, "notification:created", notification);
    }
    created += notifications.length;
  }
  return created;
}

async function recipientsFor(row: DueRow): Promise<string[]> {
  const people = await query<{ id: string }>(
    `SELECT id FROM monitor_columns
     WHERE sheet_id = $1 AND type = 'person' AND deleted_at IS NULL
     ORDER BY position
     LIMIT 1`,
    [row.sheet_id],
  );
  const ids: string[] = [];
  const value = people[0] ? row.data[people[0].id] : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        ids.push(item);
      }
    }
  }
  if (row.created_by) {
    ids.push(row.created_by);
  }
  return [...new Set(ids)];
}

function rowIsDoneFromData(data: Record<string, unknown>, columns: StatusColumn[]): boolean {
  for (const column of columns) {
    const value = data[column.id];
    if (typeof value !== "string") {
      continue;
    }
    const option = (column.settings.options ?? []).find((item) => item.id === value);
    if (option?.label && isDoneLabel(option.label)) {
      return true;
    }
  }
  return false;
}

function shift(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days);
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${nextMonth}-${nextDay}`;
}
