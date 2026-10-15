import { query, queryOne, tx } from "@/lib/db";
import type { FileAttachment, RowUpdateDto, UpdateAuthorDto } from "@/lib/db-types";
import { canonicalizeUrl } from "@/lib/urls";
import { asFileList } from "@/lib/sheets/column-meta";
import { insertNotifications, type PendingNotification } from "@/lib/notifications/repo";
import { emitToSheet, emitToUser } from "@/lib/realtime/emit";

const BODY_MAX = 8000;

interface UpdateRow {
  id: string;
  body: string;
  author_id: string;
  mentions: string[];
  attachments?: unknown;
  created_at: Date;
  updated_at: Date;
  full_name: string;
  avatar_color: string;
}

export async function listRowUpdates(sheetId: string, rowId: string): Promise<RowUpdateDto[]> {
  const updates = await query<UpdateRow>(
    `SELECT u.id, u.body, u.author_id, u.mentions, u.attachments, u.created_at, u.updated_at,
            a.full_name, a.avatar_color
     FROM monitor_updates u
     JOIN monitor_users a ON a.id = u.author_id
     WHERE u.sheet_id = $1 AND u.row_id = $2 AND u.deleted_at IS NULL
     ORDER BY u.created_at`,
    [sheetId, rowId],
  );
  if (updates.length === 0) {
    return [];
  }
  const ids = updates.map((row) => row.id);
  const replies = await query<UpdateRow & { update_id: string }>(
    `SELECT r.id, r.update_id, r.body, r.author_id, r.mentions, r.created_at, r.updated_at,
            a.full_name, a.avatar_color
     FROM monitor_update_replies r
     JOIN monitor_users a ON a.id = r.author_id
     WHERE r.update_id = ANY($1::uuid[]) AND r.deleted_at IS NULL
     ORDER BY r.created_at`,
    [ids],
  );
  const reactions = await query<{ update_id: string; user_id: string; emoji: string }>(
    `SELECT update_id, user_id, emoji FROM monitor_update_reactions WHERE update_id = ANY($1::uuid[])`,
    [ids],
  );
  const reads = await query<{ update_id: string; user_id: string; full_name: string; avatar_color: string }>(
    `SELECT r.update_id, r.user_id, u.full_name, u.avatar_color
     FROM monitor_update_reads r
     JOIN monitor_users u ON u.id = r.user_id
     WHERE r.update_id = ANY($1::uuid[])`,
    [ids],
  );
  return updates.map((update) => ({
    id: update.id,
    body: update.body,
    author: authorOf(update),
    mentions: update.mentions ?? [],
    attachments: asFileList(update.attachments),
    replies: replies
      .filter((reply) => reply.update_id === update.id)
      .map((reply) => ({
        id: reply.id,
        body: reply.body,
        author: authorOf(reply),
        mentions: reply.mentions ?? [],
        createdAt: reply.created_at.toISOString(),
        updatedAt: reply.updated_at.toISOString(),
      })),
    reactions: groupReactions(reactions.filter((item) => item.update_id === update.id)),
    seenBy: reads
      .filter((item) => item.update_id === update.id)
      .map((item) => ({ id: item.user_id, fullName: item.full_name, avatarColor: item.avatar_color })),
    createdAt: update.created_at.toISOString(),
    updatedAt: update.updated_at.toISOString(),
  }));
}

export async function countUpdatesByRow(sheetId: string): Promise<Record<string, number>> {
  const rows = await query<{ row_id: string; count: string }>(
    `SELECT row_id, count(*)::text AS count
     FROM monitor_updates
     WHERE sheet_id = $1 AND deleted_at IS NULL
     GROUP BY row_id`,
    [sheetId],
  );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.row_id] = Number(row.count);
  }
  return counts;
}

export async function createUpdate(input: {
  sheetId: string;
  rowId: string;
  authorId: string;
  body: string;
  mentions: string[];
  attachments?: FileAttachment[];
}): Promise<RowUpdateDto> {
  const body = cleanBody(input.body);
  const mentions = uniqueIds(input.mentions);
  const attachments = asFileList(input.attachments ?? []).flatMap((file) => {
    const url = canonicalizeUrl(file.url);
    if (!url || !file.name.trim()) {
      return [];
    }
    return [{ id: file.id, name: file.name.trim(), url }];
  });
  const created = await tx(async (client) => {
    await assertRow(client, input.sheetId, input.rowId);
    const result = await client.query<UpdateRow>(
      `INSERT INTO monitor_updates (sheet_id, row_id, body, author_id, mentions, attachments)
       VALUES ($1, $2, $3, $4, $5::uuid[], $6::jsonb)
       RETURNING id, body, author_id, mentions, attachments, created_at, updated_at,
         (SELECT full_name FROM monitor_users WHERE id = $4) AS full_name,
         (SELECT avatar_color FROM monitor_users WHERE id = $4) AS avatar_color`,
      [input.sheetId, input.rowId, body, input.authorId, mentions, JSON.stringify(attachments)],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Could not post the update.");
    }
    const notifications = await insertNotifications(
      client,
      mentions.map((userId) => ({
        userId,
        type: "mention" as const,
        sheetId: input.sheetId,
        rowId: input.rowId,
        actorId: input.authorId,
        payload: { updateId: row.id, excerpt: clip(body) },
      })),
    );
    return { row, notifications };
  });
  const dto = toSingle(created.row);
  emitToSheet(input.sheetId, "update.created", { sheetId: input.sheetId, rowId: input.rowId, update: dto });
  for (const notification of created.notifications) {
    emitToUser(notification.userId, "notification:created", notification);
  }
  return dto;
}

export async function editUpdate(input: {
  sheetId: string;
  rowId: string;
  updateId: string;
  authorId: string;
  body: string;
  mentions: string[];
}): Promise<RowUpdateDto | null> {
  const body = cleanBody(input.body);
  const mentions = uniqueIds(input.mentions);
  const row = await queryOne<UpdateRow>(
    `UPDATE monitor_updates
     SET body = $5, mentions = $6::uuid[]
     WHERE id = $1 AND sheet_id = $2 AND row_id = $3 AND author_id = $4 AND deleted_at IS NULL
     RETURNING id, body, author_id, mentions, created_at, updated_at,
       (SELECT full_name FROM monitor_users WHERE id = $4) AS full_name,
       (SELECT avatar_color FROM monitor_users WHERE id = $4) AS avatar_color`,
    [input.updateId, input.sheetId, input.rowId, input.authorId, body, mentions],
  );
  if (!row) {
    return null;
  }
  const dto = toSingle(row);
  emitToSheet(input.sheetId, "update.edited", { sheetId: input.sheetId, rowId: input.rowId, update: dto });
  return dto;
}

export async function deleteUpdate(input: {
  sheetId: string;
  rowId: string;
  updateId: string;
  authorId: string;
}): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE monitor_updates
     SET deleted_at = now()
     WHERE id = $1 AND sheet_id = $2 AND row_id = $3 AND author_id = $4 AND deleted_at IS NULL
     RETURNING id`,
    [input.updateId, input.sheetId, input.rowId, input.authorId],
  );
  if (!row) {
    return false;
  }
  emitToSheet(input.sheetId, "update.deleted", {
    sheetId: input.sheetId,
    rowId: input.rowId,
    updateId: input.updateId,
  });
  return true;
}

export async function createReply(input: {
  sheetId: string;
  rowId: string;
  updateId: string;
  authorId: string;
  body: string;
  mentions: string[];
}): Promise<RowUpdateDto | null> {
  const body = cleanBody(input.body);
  const mentions = uniqueIds(input.mentions);
  const result = await tx(async (client) => {
    const parent = await client.query<{ id: string; author_id: string }>(
      `SELECT id, author_id FROM monitor_updates
       WHERE id = $1 AND sheet_id = $2 AND row_id = $3 AND deleted_at IS NULL`,
      [input.updateId, input.sheetId, input.rowId],
    );
    if (!parent.rows[0]) {
      return null;
    }
    await client.query(
      `INSERT INTO monitor_update_replies (update_id, sheet_id, row_id, body, author_id, mentions)
       VALUES ($1, $2, $3, $4, $5, $6::uuid[])`,
      [input.updateId, input.sheetId, input.rowId, body, input.authorId, mentions],
    );
    const pending: PendingNotification[] = mentions.map((userId) => ({
      userId,
      type: "mention",
      sheetId: input.sheetId,
      rowId: input.rowId,
      actorId: input.authorId,
      payload: { updateId: input.updateId, excerpt: clip(body) },
    }));
    if (parent.rows[0].author_id !== input.authorId) {
      pending.push({
        userId: parent.rows[0].author_id,
        type: "reply",
        sheetId: input.sheetId,
        rowId: input.rowId,
        actorId: input.authorId,
        payload: { updateId: input.updateId, excerpt: clip(body) },
      });
    }
    const notifications = await insertNotifications(client, pending);
    return { notifications };
  });
  if (!result) {
    return null;
  }
  const thread = await listRowUpdates(input.sheetId, input.rowId);
  const update = thread.find((item) => item.id === input.updateId) ?? null;
  if (update) {
    emitToSheet(input.sheetId, "update.created", { sheetId: input.sheetId, rowId: input.rowId, update });
  }
  for (const notification of result.notifications) {
    emitToUser(notification.userId, "notification:created", notification);
  }
  return update;
}

export async function editReply(input: {
  sheetId: string;
  rowId: string;
  replyId: string;
  authorId: string;
  body: string;
  mentions: string[];
}): Promise<RowUpdateDto | null> {
  const body = cleanBody(input.body);
  const mentions = uniqueIds(input.mentions);
  const row = await queryOne<{ update_id: string }>(
    `UPDATE monitor_update_replies
     SET body = $5, mentions = $6::uuid[]
     WHERE id = $1 AND sheet_id = $2 AND row_id = $3 AND author_id = $4 AND deleted_at IS NULL
     RETURNING update_id`,
    [input.replyId, input.sheetId, input.rowId, input.authorId, body, mentions],
  );
  if (!row) {
    return null;
  }
  const thread = await listRowUpdates(input.sheetId, input.rowId);
  const update = thread.find((item) => item.id === row.update_id) ?? null;
  if (update) {
    emitToSheet(input.sheetId, "update.edited", { sheetId: input.sheetId, rowId: input.rowId, update });
  }
  return update;
}

export async function deleteReply(input: {
  sheetId: string;
  rowId: string;
  replyId: string;
  authorId: string;
}): Promise<boolean> {
  const row = await queryOne<{ update_id: string }>(
    `UPDATE monitor_update_replies
     SET deleted_at = now()
     WHERE id = $1 AND sheet_id = $2 AND row_id = $3 AND author_id = $4 AND deleted_at IS NULL
     RETURNING update_id`,
    [input.replyId, input.sheetId, input.rowId, input.authorId],
  );
  if (!row) {
    return false;
  }
  emitToSheet(input.sheetId, "update.deleted", {
    sheetId: input.sheetId,
    rowId: input.rowId,
    updateId: row.update_id,
    replyId: input.replyId,
  });
  return true;
}

export async function toggleReaction(input: {
  sheetId: string;
  rowId: string;
  updateId: string;
  userId: string;
}): Promise<RowUpdateDto | null> {
  const exists = await queryOne<{ update_id: string }>(
    `SELECT update_id FROM monitor_update_reactions WHERE update_id = $1 AND user_id = $2 AND emoji = '👍'`,
    [input.updateId, input.userId],
  );
  if (exists) {
    await query(`DELETE FROM monitor_update_reactions WHERE update_id = $1 AND user_id = $2 AND emoji = '👍'`, [
      input.updateId,
      input.userId,
    ]);
  } else {
    const parent = await queryOne<{ id: string }>(
      `SELECT id FROM monitor_updates WHERE id = $1 AND sheet_id = $2 AND row_id = $3 AND deleted_at IS NULL`,
      [input.updateId, input.sheetId, input.rowId],
    );
    if (!parent) {
      return null;
    }
    await query(
      `INSERT INTO monitor_update_reactions (update_id, user_id, emoji) VALUES ($1, $2, '👍')`,
      [input.updateId, input.userId],
    );
  }
  const thread = await listRowUpdates(input.sheetId, input.rowId);
  const update = thread.find((item) => item.id === input.updateId) ?? null;
  if (update) {
    emitToSheet(input.sheetId, "update.reacted", { sheetId: input.sheetId, rowId: input.rowId, update });
  }
  return update;
}

export async function markUpdateSeen(input: {
  sheetId: string;
  rowId: string;
  userId: string;
}): Promise<void> {
  await query(
    `INSERT INTO monitor_update_reads (update_id, user_id)
     SELECT id, $3
     FROM monitor_updates
     WHERE sheet_id = $1 AND row_id = $2 AND deleted_at IS NULL
     ON CONFLICT (update_id, user_id) DO UPDATE SET seen_at = now()`,
    [input.sheetId, input.rowId, input.userId],
  );
  emitToSheet(input.sheetId, "update.seen", { sheetId: input.sheetId, rowId: input.rowId, userId: input.userId });
}

async function assertRow(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ id: string }> }> },
  sheetId: string,
  rowId: string,
): Promise<void> {
  const row = await client.query(`SELECT id FROM monitor_rows WHERE id = $1 AND sheet_id = $2 AND deleted_at IS NULL`, [
    rowId,
    sheetId,
  ]);
  if (!row.rows[0]) {
    throw new Error("Row not found.");
  }
}

function toSingle(row: UpdateRow): RowUpdateDto {
  return {
    id: row.id,
    body: row.body,
    author: authorOf(row),
    mentions: row.mentions ?? [],
    attachments: asFileList(row.attachments),
    replies: [],
    reactions: [],
    seenBy: [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function authorOf(row: { author_id: string; full_name: string; avatar_color: string }): UpdateAuthorDto {
  return { id: row.author_id, fullName: row.full_name, avatarColor: row.avatar_color };
}

function groupReactions(rows: Array<{ emoji: string; user_id: string }>): Array<{ emoji: string; userIds: string[] }> {
  const byEmoji = new Map<string, string[]>();
  for (const row of rows) {
    const list = byEmoji.get(row.emoji) ?? [];
    list.push(row.user_id);
    byEmoji.set(row.emoji, list);
  }
  return [...byEmoji.entries()].map(([emoji, userIds]) => ({ emoji, userIds }));
}

function cleanBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > BODY_MAX) {
    throw new Error(trimmed ? "Update is too long." : "Write an update.");
  }
  return trimmed;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
}

function clip(text: string): string {
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}
