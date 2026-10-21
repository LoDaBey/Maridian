"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { query } from "@/lib/db";
import { emitToSheet, emitToUser } from "@/lib/realtime/emit";
import { broadcastSheetsChanged } from "@/lib/realtime/socket-server";
import {
  getSheetAccess,
  listWorkbookMembers,
  loadProtections,
  type Protection,
  type ProtectionScope,
} from "@/lib/sheets/workbook-access";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

export interface ProtectionPerson {
  id: string;
  fullName: string;
  avatarColor: string;
  access: "owner" | "editor" | "viewer";
}

export interface ProtectionSettings {
  error: string;
  canManage: boolean;
  people: ProtectionPerson[];
  protections: Protection[];
  visibleTo: string[] | null;
}

async function requireManager(sheetId: string) {
  const user = await requireUser();
  const parsed = z.uuid().safeParse(sheetId);
  if (!parsed.success) {
    return { error: "Sheet not found." } as const;
  }
  const access = await getSheetAccess(user, parsed.data);
  if (!access) {
    return { error: "You don't have access to this sheet." } as const;
  }
  return { user, access, sheetId: parsed.data } as const;
}

/** People on the sheet, current locks and tab visibility, for the protection dialogs. */
export async function getProtectionSettings(input: { sheetId: string }): Promise<ProtectionSettings> {
  const empty = { canManage: false, people: [], protections: [], visibleTo: null };
  const context = await requireManager(input.sheetId);
  if ("error" in context) {
    return { error: context.error ?? "", ...empty };
  }
  const [members, protections, sheet] = await Promise.all([
    listWorkbookMembers(context.access.workbookId),
    loadProtections(context.sheetId),
    query<{ visible_to: string[] | null }>(`SELECT visible_to FROM monitor_sheets WHERE id = $1`, [context.sheetId]),
  ]);
  return {
    error: "",
    canManage: context.access.canManage,
    people: members.map((member) => ({
      id: member.userId,
      fullName: member.fullName,
      avatarColor: member.avatarColor,
      access: member.boardRole,
    })),
    protections: context.access.canManage ? protections : [],
    visibleTo: sheet[0]?.visible_to ?? null,
  };
}

const scopeSchema = z.enum(["tab", "group", "column"]);

const protectionSchema = z
  .object({
    sheetId: z.uuid(),
    scope: scopeSchema,
    targetId: z.uuid().nullable(),
    editors: z.array(z.uuid()).max(500),
  })
  .refine((value) => (value.scope === "tab") === (value.targetId === null), { message: "Choose what to protect." });

/** The group or column must belong to this tab. */
async function targetExists(sheetId: string, scope: ProtectionScope, targetId: string | null): Promise<boolean> {
  if (scope === "tab") {
    return true;
  }
  const table = scope === "group" ? "monitor_groups" : "monitor_columns";
  const rows = await query<{ ok: number }>(
    `SELECT 1 AS ok FROM ${table} WHERE id = $1 AND sheet_id = $2 AND deleted_at IS NULL`,
    [targetId, sheetId],
  );
  return rows.length > 0;
}

function changed(sheetId: string): void {
  emitToSheet(sheetId, "sheet:protection-changed", { sheetId });
  revalidatePath("/", "layout");
}

export async function saveProtection(input: {
  sheetId: string;
  scope: ProtectionScope;
  targetId: string | null;
  editors: string[];
}): Promise<{ error: string }> {
  const parsed = protectionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the protection." };
  }
  const context = await requireManager(parsed.data.sheetId);
  if ("error" in context) {
    return { error: context.error ?? "" };
  }
  if (!context.access.canManage) {
    return { error: "Only the sheet owner or a workspace admin can protect parts of a sheet." };
  }
  if (!(await targetExists(parsed.data.sheetId, parsed.data.scope, parsed.data.targetId))) {
    return { error: "That group or column no longer exists." };
  }
  await query(
    `INSERT INTO monitor_protections (sheet_id, scope, target_id, editors, created_by)
     VALUES ($1, $2, $3, $4::uuid[], $5)
     ON CONFLICT (sheet_id, scope, COALESCE(target_id, '${ZERO_UUID}'::uuid))
     DO UPDATE SET editors = EXCLUDED.editors`,
    [parsed.data.sheetId, parsed.data.scope, parsed.data.targetId, parsed.data.editors, context.user.id],
  );
  changed(parsed.data.sheetId);
  return { error: "" };
}

export async function removeProtection(input: {
  sheetId: string;
  scope: ProtectionScope;
  targetId: string | null;
}): Promise<{ error: string }> {
  const parsed = z
    .object({ sheetId: z.uuid(), scope: scopeSchema, targetId: z.uuid().nullable() })
    .safeParse(input);
  if (!parsed.success) {
    return { error: "Protection not found." };
  }
  const context = await requireManager(parsed.data.sheetId);
  if ("error" in context) {
    return { error: context.error ?? "" };
  }
  if (!context.access.canManage) {
    return { error: "Only the sheet owner or a workspace admin can remove protection." };
  }
  await query(
    `DELETE FROM monitor_protections
     WHERE sheet_id = $1 AND scope = $2 AND COALESCE(target_id, '${ZERO_UUID}'::uuid) = COALESCE($3::uuid, '${ZERO_UUID}'::uuid)`,
    [parsed.data.sheetId, parsed.data.scope, parsed.data.targetId],
  );
  changed(parsed.data.sheetId);
  return { error: "" };
}

/**
 * Shows a tab to everyone with access (null), or only to the listed people.
 * People who lose sight of it are moved off it if they have it open.
 */
export async function setTabVisibility(input: {
  sheetId: string;
  visibleTo: string[] | null;
}): Promise<{ error: string }> {
  const parsed = z
    .object({ sheetId: z.uuid(), visibleTo: z.array(z.uuid()).max(500).nullable() })
    .safeParse(input);
  if (!parsed.success) {
    return { error: "Check who can see this tab." };
  }
  const context = await requireManager(parsed.data.sheetId);
  if ("error" in context) {
    return { error: context.error ?? "" };
  }
  if (!context.access.canManage) {
    return { error: "Only the sheet owner or a workspace admin can hide tabs." };
  }
  await query(`UPDATE monitor_sheets SET visible_to = $2::uuid[] WHERE id = $1`, [
    parsed.data.sheetId,
    parsed.data.visibleTo,
  ]);
  if (parsed.data.visibleTo) {
    const allowed = new Set(parsed.data.visibleTo);
    const members = await listWorkbookMembers(context.access.workbookId);
    for (const member of members) {
      if (allowed.has(member.userId)) {
        continue;
      }
      // Re-check: owners and workspace admins still see hidden tabs.
      const still = await getSheetAccess({ id: member.userId, role: member.role }, parsed.data.sheetId);
      if (!still) {
        emitToUser(member.userId, "access:revoked", { sheetIds: [parsed.data.sheetId] });
      }
    }
  }
  broadcastSheetsChanged();
  changed(parsed.data.sheetId);
  return { error: "" };
}
