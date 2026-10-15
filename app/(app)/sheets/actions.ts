"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, requireUser } from "@/lib/auth/current-user";
import type { DirectoryUser, WorkbookMember } from "@/lib/db-types";
import { query } from "@/lib/db";
import { canShareWorkbook } from "@/lib/rbac";
import { broadcastSheetMeta, broadcastSheetsChanged } from "@/lib/realtime/socket-server";
import {
  archiveSheetRecord,
  createTabRecord,
  createWorkbookFromSavedTemplate,
  createWorkbookRecord,
  deleteSheetTemplateRecord,
  duplicateSheetRecord,
  purgeWorkbookRecord,
  softDeleteWorkbookRecord,
  getSheet,
  moveSheetRecord,
  renameSheetRecord,
  restoreSheetRecord,
  restoreWorkbookRecord,
  saveWorkbookAsTemplate,
  setSheetDirectionRecord,
  SheetActionError,
} from "@/lib/sheets/sheets-repo";
import { SHEET_TEMPLATES, type SheetTemplateId } from "@/lib/sheets/templates";
import {
  listWorkbookMembers,
  shareWorkbookWithUsers,
  unshareWorkbookUser,
  userCanAccessSheet,
  userCanAccessWorkbook,
} from "@/lib/sheets/workbook-access";
import { listDirectoryUsers } from "@/lib/users";

export interface SheetMutationResult {
  error: string;
  id: string | null;
  nextTabId?: string | null;
  workbookArchived?: boolean;
}

const nameSchema = z.string().trim().min(1, "Enter a sheet name.").max(100, "Use 100 characters or fewer.");

const createSchema = z
  .object({
    name: nameSchema,
    template: z.enum(SHEET_TEMPLATES).optional(),
    savedTemplateId: z.uuid("Template not found.").optional(),
  })
  .refine((value) => Boolean(value.template) !== Boolean(value.savedTemplateId), {
    message: "Choose a template.",
  });

const saveTemplateSchema = z.object({
  workbookId: z.uuid("Sheet not found."),
  name: nameSchema,
});

const createTabSchema = z.object({
  workbookId: z.uuid("Sheet not found."),
  name: nameSchema,
  template: z.enum(SHEET_TEMPLATES),
});

const renameSchema = z.object({
  id: z.uuid("Sheet not found."),
  name: nameSchema,
});

const directionSchema = z.object({
  id: z.uuid("Sheet not found."),
  direction: z.enum(["rtl", "ltr"]),
});

const moveSchema = z
  .object({
    id: z.uuid("Sheet not found."),
    beforeId: z.uuid("Sheet not found.").optional(),
    afterId: z.uuid("Sheet not found.").optional(),
  })
  .refine((value) => Boolean(value.beforeId) !== Boolean(value.afterId), {
    message: "Choose another sheet.",
  });

const idSchema = z.object({
  id: z.uuid("Sheet not found."),
});

const duplicateSchema = z.object({
  id: z.uuid("Sheet not found."),
  name: nameSchema,
  withRows: z.boolean(),
});

function fieldError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again.";
}

function failure(error: unknown): SheetMutationResult {
  if (error instanceof SheetActionError) {
    return { error: error.message, id: null };
  }
  throw error;
}

function publish(): void {
  broadcastSheetsChanged();
  revalidatePath("/", "layout");
}

async function requireSheetAccess(
  actor: { id: string; role: import("@/lib/rbac").Role },
  sheetId: string,
): Promise<string | null> {
  if (!(await userCanAccessSheet(actor, sheetId))) {
    return "You don't have access to this sheet.";
  }
  return null;
}

async function requireWorkbookAccess(
  actor: { id: string; role: import("@/lib/rbac").Role },
  workbookId: string,
): Promise<string | null> {
  if (!(await userCanAccessWorkbook(actor, workbookId))) {
    return "You don't have access to this sheet.";
  }
  return null;
}

async function publishMeta(id: string): Promise<void> {
  publish();
  const sheet = await getSheet(id);
  if (!sheet) {
    return;
  }
  broadcastSheetMeta({
    id: sheet.id,
    name: sheet.name,
    direction: sheet.direction,
    archived: sheet.archivedAt !== null,
  });
}

export async function createSheet(input: {
  name: string;
  template?: SheetTemplateId;
  savedTemplateId?: string;
}): Promise<SheetMutationResult> {
  const actor = await requirePermission("sheet.create");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error), id: null };
  }

  try {
    const created = parsed.data.savedTemplateId
      ? await createWorkbookFromSavedTemplate({
          actorId: actor.id,
          name: parsed.data.name,
          templateId: parsed.data.savedTemplateId,
        })
      : await createWorkbookRecord({
          actorId: actor.id,
          name: parsed.data.name,
          template: parsed.data.template ?? "blank",
        });
    publish();
    return { error: "", id: created.id };
  } catch (error) {
    return failure(error);
  }
}

export async function saveSheetTemplate(input: {
  workbookId: string;
  name: string;
}): Promise<SheetMutationResult> {
  const actor = await requirePermission("sheet.create");
  const parsed = saveTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error), id: null };
  }
  const denied = await requireWorkbookAccess(actor, parsed.data.workbookId);
  if (denied) {
    return { error: denied, id: null };
  }

  try {
    const created = await saveWorkbookAsTemplate({
      actorId: actor.id,
      workbookId: parsed.data.workbookId,
      name: parsed.data.name,
    });
    publish();
    return { error: "", id: created.id };
  } catch (error) {
    return failure(error);
  }
}

export async function createTab(input: {
  workbookId: string;
  name: string;
  template: SheetTemplateId;
}): Promise<SheetMutationResult> {
  const actor = await requirePermission("sheet.create");
  const parsed = createTabSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error), id: null };
  }
  const denied = await requireWorkbookAccess(actor, parsed.data.workbookId);
  if (denied) {
    return { error: denied, id: null };
  }

  try {
    const created = await createTabRecord({
      actorId: actor.id,
      workbookId: parsed.data.workbookId,
      name: parsed.data.name,
      template: parsed.data.template,
    });
    publish();
    return { error: "", id: created.id };
  } catch (error) {
    return failure(error);
  }
}

export async function renameSheet(input: {
  id: string;
  name: string;
}): Promise<SheetMutationResult> {
  const actor = await requirePermission("sheet.rename");
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error), id: null };
  }
  const denied = await requireSheetAccess(actor, parsed.data.id);
  if (denied) {
    return { error: denied, id: null };
  }

  try {
    const changed = await renameSheetRecord({
      actorId: actor.id,
      id: parsed.data.id,
      name: parsed.data.name,
    });
    if (changed) {
      await publishMeta(parsed.data.id);
    }
    return { error: "", id: parsed.data.id };
  } catch (error) {
    return failure(error);
  }
}

export async function setSheetDirection(input: {
  id: string;
  direction: "rtl" | "ltr";
}): Promise<SheetMutationResult> {
  const actor = await requirePermission("sheet.direction");
  const parsed = directionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error), id: null };
  }
  const denied = await requireSheetAccess(actor, parsed.data.id);
  if (denied) {
    return { error: denied, id: null };
  }

  try {
    const changed = await setSheetDirectionRecord({
      actorId: actor.id,
      id: parsed.data.id,
      direction: parsed.data.direction,
    });
    if (changed) {
      await publishMeta(parsed.data.id);
    }
    return { error: "", id: parsed.data.id };
  } catch (error) {
    return failure(error);
  }
}

export async function moveSheet(input: {
  id: string;
  beforeId?: string;
  afterId?: string;
}): Promise<SheetMutationResult> {
  const actor = await requirePermission("sheet.reorder");
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error), id: null };
  }
  const denied = await requireSheetAccess(actor, parsed.data.id);
  if (denied) {
    return { error: denied, id: null };
  }

  try {
    await moveSheetRecord({
      actorId: actor.id,
      id: parsed.data.id,
      beforeId: parsed.data.beforeId,
      afterId: parsed.data.afterId,
    });
    publish();
    return { error: "", id: parsed.data.id };
  } catch (error) {
    return failure(error);
  }
}

export async function archiveSheet(input: { id: string }): Promise<SheetMutationResult> {
  const actor = await requirePermission("sheet.archive");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error), id: null };
  }
  const denied = await requireSheetAccess(actor, parsed.data.id);
  if (denied) {
    return { error: denied, id: null };
  }

  try {
    const archived = await archiveSheetRecord({ actorId: actor.id, id: parsed.data.id });
    await publishMeta(parsed.data.id);
    return {
      error: "",
      id: parsed.data.id,
      nextTabId: archived.nextTabId,
      workbookArchived: archived.workbookArchived,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function restoreSheet(input: { id: string }): Promise<SheetMutationResult> {
  const actor = await requirePermission("sheet.restore");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error), id: null };
  }
  const denied = await requireSheetAccess(actor, parsed.data.id);
  if (denied) {
    return { error: denied, id: null };
  }

  try {
    await restoreSheetRecord({ actorId: actor.id, id: parsed.data.id });
    await publishMeta(parsed.data.id);
    return { error: "", id: parsed.data.id };
  } catch (error) {
    return failure(error);
  }
}

export async function restoreWorkbook(input: { id: string }): Promise<SheetMutationResult> {
  const actor = await requirePermission("sheet.restore");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error), id: null };
  }
  const denied = await requireWorkbookAccess(actor, parsed.data.id);
  if (denied) {
    return { error: denied, id: null };
  }

  try {
    const restored = await restoreWorkbookRecord({ actorId: actor.id, id: parsed.data.id });
    publish();
    return { error: "", id: restored.firstTabId };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteWorkbook(input: { id: string }): Promise<SheetMutationResult> {
  const actor = await requireUser();
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error), id: null };
  }
  const denied = await requireWorkbookAccess(actor, parsed.data.id);
  if (denied) {
    return { error: denied, id: null };
  }

  try {
    await softDeleteWorkbookRecord({ actorId: actor.id, id: parsed.data.id });
    publish();
    return { error: "", id: parsed.data.id };
  } catch (error) {
    return failure(error);
  }
}

export async function purgeWorkbook(input: { id: string }): Promise<SheetMutationResult> {
  const actor = await requirePermission("sheet.purge");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error), id: null };
  }

  try {
    await purgeWorkbookRecord({ actorId: actor.id, id: parsed.data.id });
    publish();
    return { error: "", id: parsed.data.id };
  } catch (error) {
    return failure(error);
  }
}

const shareSchema = z.object({
  workbookId: z.uuid("Sheet not found."),
  userIds: z.array(z.uuid("Choose a person.")).max(100),
});

const unshareSchema = z.object({
  workbookId: z.uuid("Sheet not found."),
  userId: z.uuid("Choose a person."),
});

export async function getWorkbookShareState(input: { workbookId: string }): Promise<{
  error: string;
  members: WorkbookMember[];
  users: DirectoryUser[];
  canShare: boolean;
  workbookName: string;
}> {
  const actor = await requireUser();
  const parsed = z.object({ workbookId: z.uuid("Sheet not found.") }).safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error), members: [], users: [], canShare: false, workbookName: "" };
  }
  if (!(await userCanAccessWorkbook(actor, parsed.data.workbookId))) {
    return { error: "You don't have access to this sheet.", members: [], users: [], canShare: false, workbookName: "" };
  }
  const workbooks = await query<{ name: string; created_by: string | null }>(
    `SELECT name, created_by FROM monitor_workbooks WHERE id = $1 AND deleted_at IS NULL`,
    [parsed.data.workbookId],
  );
  const workbook = workbooks[0];
  if (!workbook) {
    return { error: "Sheet not found.", members: [], users: [], canShare: false, workbookName: "" };
  }
  const [members, users] = await Promise.all([
    listWorkbookMembers(parsed.data.workbookId),
    listDirectoryUsers(),
  ]);
  return {
    error: "",
    members,
    users: users.filter((user) => user.isActive),
    canShare: canShareWorkbook(actor, { createdBy: workbook.created_by }),
    workbookName: workbook.name,
  };
}

export async function shareWorkbook(input: {
  workbookId: string;
  userIds: string[];
}): Promise<{ error: string }> {
  const actor = await requireUser();
  const parsed = shareSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error) };
  }
  if (!(await userCanAccessWorkbook(actor, parsed.data.workbookId))) {
    return { error: "You don't have access to this sheet." };
  }
  const workbooks = await query<{ created_by: string | null }>(
    `SELECT created_by FROM monitor_workbooks WHERE id = $1 AND deleted_at IS NULL`,
    [parsed.data.workbookId],
  );
  const workbook = workbooks[0];
  if (!workbook) {
    return { error: "Sheet not found." };
  }
  if (!canShareWorkbook(actor, { createdBy: workbook.created_by })) {
    return { error: "You don't have permission to share this sheet." };
  }
  await shareWorkbookWithUsers({
    actorId: actor.id,
    workbookId: parsed.data.workbookId,
    userIds: parsed.data.userIds,
  });
  revalidatePath("/", "layout");
  return { error: "" };
}

export async function unshareWorkbook(input: {
  workbookId: string;
  userId: string;
}): Promise<{ error: string }> {
  const actor = await requireUser();
  const parsed = unshareSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error) };
  }
  if (!(await userCanAccessWorkbook(actor, parsed.data.workbookId))) {
    return { error: "You don't have access to this sheet." };
  }
  const workbooks = await query<{ created_by: string | null }>(
    `SELECT created_by FROM monitor_workbooks WHERE id = $1 AND deleted_at IS NULL`,
    [parsed.data.workbookId],
  );
  const workbook = workbooks[0];
  if (!workbook) {
    return { error: "Sheet not found." };
  }
  if (!canShareWorkbook(actor, { createdBy: workbook.created_by })) {
    return { error: "You don't have permission to share this sheet." };
  }
  const result = await unshareWorkbookUser(parsed.data);
  if (result === "owner") {
    return { error: "The owner can't be removed." };
  }
  if (result === "missing") {
    return { error: "That person isn't on this sheet." };
  }
  revalidatePath("/", "layout");
  return { error: "" };
}

export async function duplicateSheet(input: {
  id: string;
  name: string;
  withRows: boolean;
}): Promise<SheetMutationResult> {
  const actor = await requirePermission("sheet.duplicate");
  const parsed = duplicateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error), id: null };
  }
  const denied = await requireSheetAccess(actor, parsed.data.id);
  if (denied) {
    return { error: denied, id: null };
  }

  try {
    const created = await duplicateSheetRecord({
      actorId: actor.id,
      id: parsed.data.id,
      name: parsed.data.name,
      withRows: parsed.data.withRows,
    });
    publish();
    return { error: "", id: created.id };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteSheetTemplate(input: { id: string }): Promise<SheetMutationResult> {
  const actor = await requirePermission("template.delete");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error), id: null };
  }

  try {
    await deleteSheetTemplateRecord({ id: parsed.data.id });
    revalidatePath("/", "layout");
    return { error: "", id: parsed.data.id };
  } catch (error) {
    return failure(error);
  }
}
