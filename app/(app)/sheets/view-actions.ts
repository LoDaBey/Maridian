"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { query } from "@/lib/db";
import { getSheetAccess } from "@/lib/sheets/workbook-access";

export interface SavedView {
  id: string;
  name: string;
  view: Record<string, unknown>;
  createdBy: string | null;
  createdByName: string | null;
  canDelete: boolean;
}

const viewSchema = z.object({
  search: z.string().max(200).default(""),
  filters: z.array(z.record(z.string(), z.unknown())).max(30).default([]),
  sort: z.object({ columnId: z.string(), direction: z.enum(["asc", "desc"]) }).nullable().default(null),
  mine: z.boolean().default(false),
  today: z.boolean().default(false),
});

/** Saved views on a tab; everyone who can open the tab sees them. */
export async function listSavedViews(sheetId: string): Promise<SavedView[]> {
  const user = await requireUser();
  const id = z.uuid().safeParse(sheetId);
  const access = id.success ? await getSheetAccess(user, id.data) : null;
  if (!id.success || !access) {
    return [];
  }
  const rows = await query<{ id: string; name: string; view: Record<string, unknown>; created_by: string | null; full_name: string | null }>(
    `SELECT v.id, v.name, v.view, v.created_by, u.full_name
     FROM monitor_saved_views v LEFT JOIN monitor_users u ON u.id = v.created_by
     WHERE v.sheet_id = $1
     ORDER BY v.created_at`,
    [id.data],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    view: row.view,
    createdBy: row.created_by,
    createdByName: row.full_name,
    canDelete: row.created_by === user.id || access.canManage,
  }));
}

export async function saveView(input: { sheetId: string; name: string; view: unknown }): Promise<{ error: string }> {
  const user = await requireUser();
  const id = z.uuid().safeParse(input.sheetId);
  const name = z.string().trim().min(1, "Name the view.").max(60).safeParse(input.name);
  const view = viewSchema.safeParse(input.view);
  if (!id.success || !view.success) {
    return { error: "Couldn't save this view." };
  }
  if (!name.success) {
    return { error: name.error.issues[0]?.message ?? "Name the view." };
  }
  const access = await getSheetAccess(user, id.data);
  if (!access || access.role === "viewer") {
    return { error: "Only people who can edit this sheet can save views." };
  }
  await query(`INSERT INTO monitor_saved_views (sheet_id, name, view, created_by) VALUES ($1, $2, $3::jsonb, $4)`, [
    id.data,
    name.data,
    JSON.stringify(view.data),
    user.id,
  ]);
  return { error: "" };
}

export async function deleteView(input: { sheetId: string; viewId: string }): Promise<{ error: string }> {
  const user = await requireUser();
  const sheetId = z.uuid().safeParse(input.sheetId);
  const viewId = z.uuid().safeParse(input.viewId);
  const access = sheetId.success ? await getSheetAccess(user, sheetId.data) : null;
  if (!sheetId.success || !viewId.success || !access) {
    return { error: "View not found." };
  }
  await query(`DELETE FROM monitor_saved_views WHERE id = $1 AND sheet_id = $2 AND (created_by = $3 OR $4)`, [
    viewId.data,
    sheetId.data,
    user.id,
    access.canManage,
  ]);
  return { error: "" };
}
