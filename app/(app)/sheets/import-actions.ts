"use server";

import { randomUUID } from "node:crypto";
import { generateNKeysBetween } from "fractional-indexing";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { SessionUser } from "@/lib/auth/session";
import { requireUser } from "@/lib/auth/current-user";
import { query, queryOne } from "@/lib/db";
import { can } from "@/lib/rbac";
import { listDirectoryUsers } from "@/lib/users";
import { broadcastSheetsChanged, getIO } from "@/lib/realtime/socket-server";
import { applyOp, type ApplyResult } from "@/lib/sheets/apply-op";
import { IMPORT_CHUNK_SIZE, type ImportPerson, type ImportRowsResult } from "@/lib/sheets/csv";
import { COLUMN_TYPES } from "@/lib/sheets/ops";
import { createWorkbookFromImport } from "@/lib/sheets/sheets-repo";
import { getSheetAccess } from "@/lib/sheets/workbook-access";
import { getWorkspace } from "@/lib/workspaces/repo";

const columnSchema = z.object({
  columnId: z.uuid(),
  name: z.string().trim().min(1, "Enter a column name.").max(100, "Use 100 characters or fewer."),
  type: z.enum(COLUMN_TYPES),
  settings: z.unknown(),
});

const tabSchema = z.object({
  name: z.string().trim().min(1, "Enter a tab name.").max(100, "Use 100 characters or fewer."),
  newColumns: z.array(columnSchema).max(50).default([]),
  statusUpdates: z
    .array(
      z.object({
        columnId: z.uuid(),
        settings: z.unknown(),
      }),
    )
    .max(50)
    .default([]),
  rows: z
    .array(
      z.object({
        rowId: z.uuid(),
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .max(IMPORT_CHUNK_SIZE),
  skippedCells: z.number().int().nonnegative().max(1_000_000).default(0),
  unmatchedPeople: z.array(z.string().max(200)).max(1_000).default([]),
});

const inputSchema = z
  .object({
    mode: z.enum(["append", "new"]),
    sheetId: z.uuid().optional(),
    workspaceId: z.uuid().optional(),
    name: z.string().trim().min(1, "Enter a sheet name.").max(100, "Use 100 characters or fewer.").optional(),
    newColumns: z.array(columnSchema).max(50).default([]),
    statusUpdates: z
      .array(
        z.object({
          columnId: z.uuid(),
          settings: z.unknown(),
        }),
      )
      .max(50)
      .default([]),
    rows: z
      .array(
        z.object({
          rowId: z.uuid(),
          data: z.record(z.string(), z.unknown()),
        }),
      )
      .max(IMPORT_CHUNK_SIZE)
      .default([]),
    tabs: z.array(tabSchema).max(50).optional(),
    skippedCells: z.number().int().nonnegative().max(1_000_000).default(0),
    unmatchedPeople: z.array(z.string().max(200)).max(1_000).default([]),
  })
  .superRefine((value, context) => {
    if (value.mode === "append" && !value.sheetId) {
      context.addIssue({ code: "custom", message: "Sheet not found.", path: ["sheetId"] });
    }
    if (value.mode === "new" && !value.name) {
      context.addIssue({ code: "custom", message: "Enter a sheet name.", path: ["name"] });
    }
    if (value.mode === "new" && (!value.tabs || value.tabs.length === 0) && value.newColumns.length === 0 && value.rows.length === 0) {
      context.addIssue({ code: "custom", message: "Import at least one tab.", path: ["tabs"] });
    }
  });

function failure(error: string, sheetId: string | null, skippedCells: number, unmatchedPeople: string[]): ImportRowsResult {
  return { ok: false, error, sheetId, inserted: 0, skippedCells, unmatchedPeople };
}

export async function loadImportPeople(): Promise<{ people: ImportPerson[]; error: string }> {
  const user = await requireUser();
  if (!can(user.role, "sheet.create") && !can(user.role, "csv.import")) {
    return { people: [], error: "You don't have permission to do that." };
  }
  const users = await listDirectoryUsers();
  return {
    people: users.map((user) => ({ id: user.id, fullName: user.fullName, email: user.email })),
    error: "",
  };
}

export async function importRows(input: unknown): Promise<ImportRowsResult> {
  const user = await requireUser();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "Check the import and try again.", null, 0, []);
  }

  const data = parsed.data;
  if (data.mode === "new") {
    if (!can(user.role, "sheet.create")) {
      return failure("You don't have permission to do that.", null, data.skippedCells, data.unmatchedPeople);
    }
    // A new sheet goes into the chosen workspace, or the one the import started from.
    const workspaceId =
      data.workspaceId ?? (data.sheetId ? (await getSheetAccess(user, data.sheetId))?.workspaceId : undefined);
    if (!workspaceId || !(await getWorkspace(user, workspaceId))) {
      return failure("Choose a workspace you belong to.", null, data.skippedCells, data.unmatchedPeople);
    }
    const sourceTabs =
      data.tabs && data.tabs.length > 0
        ? data.tabs
        : [
            {
              name: "Tab 1",
              newColumns: data.newColumns,
              statusUpdates: data.statusUpdates,
              rows: data.rows,
              skippedCells: data.skippedCells,
              unmatchedPeople: data.unmatchedPeople,
            },
          ];
    try {
      const created = await createWorkbookFromImport({
        actorId: user.id,
        workspaceId,
        name: data.name ?? "",
        tabs: sourceTabs.map((tab, index) => {
          const settingsByColumn = new Map(tab.newColumns.map((column) => [column.columnId, column.settings]));
          for (const update of tab.statusUpdates) {
            settingsByColumn.set(update.columnId, update.settings);
          }
          return {
            name: tab.name.trim() || `Tab ${index + 1}`,
            columns: tab.newColumns.map((column) => ({
              id: column.columnId,
              name: column.name,
              type: column.type,
              settings: (settingsByColumn.get(column.columnId) ?? column.settings) as Record<string, unknown>,
            })),
            rows: tab.rows.map((row) => ({ id: row.rowId, data: row.data })),
          };
        }),
      });
      broadcastSheetsChanged();
      revalidatePath("/", "layout");
      const inserted = sourceTabs.reduce((sum, tab) => sum + tab.rows.length, 0);
      const skippedCells = sourceTabs.reduce((sum, tab) => sum + tab.skippedCells, 0);
      const unmatchedPeople = [...new Set(sourceTabs.flatMap((tab) => tab.unmatchedPeople))];
      return {
        ok: true,
        error: "",
        sheetId: created.id,
        inserted,
        skippedCells,
        unmatchedPeople,
        tabs: created.tabs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create the sheet.";
      return failure(message, null, data.skippedCells, data.unmatchedPeople);
    }
  }

  if (!can(user.role, "csv.import") && (data.newColumns.length > 0 || data.statusUpdates.length > 0)) {
    return failure("You don't have permission to do that.", data.sheetId ?? null, data.skippedCells, data.unmatchedPeople);
  }
  if (!can(user.role, "row.insert")) {
    return failure("You don't have permission to do that.", data.sheetId ?? null, data.skippedCells, data.unmatchedPeople);
  }

  const sheetId = data.sheetId ?? null;
  if (!sheetId) {
    return failure("Sheet not found.", null, data.skippedCells, data.unmatchedPeople);
  }

  const columnError = await insertColumns(user, sheetId, data.newColumns);
  if (columnError) {
    return failure(columnError, sheetId, data.skippedCells, data.unmatchedPeople);
  }
  for (const update of data.statusUpdates) {
    const result = await applyAndPublish(user, {
      clientOpId: randomUUID(),
      sheetId,
      type: "column.update",
      payload: { columnId: update.columnId, patch: { settings: update.settings } },
    });
    if (!result.ok) {
      return failure(result.message, sheetId, data.skippedCells, data.unmatchedPeople);
    }
  }

  if (data.rows.length === 0) {
    return {
      ok: true,
      error: "",
      sheetId,
      inserted: 0,
      skippedCells: data.skippedCells,
      unmatchedPeople: data.unmatchedPeople,
    };
  }

  const positions = await rowPositions(sheetId, data.rows.length);
  const inserted = await applyAndPublish(user, {
    clientOpId: randomUUID(),
    sheetId,
    type: "rows.insertMany",
    payload: {
      rows: data.rows.map((row, index) => ({
        rowId: row.rowId,
        position: positions[index] ?? `z${index}`,
        data: row.data,
      })),
    },
  });
  if (!inserted.ok) {
    return failure(inserted.message, sheetId, data.skippedCells, data.unmatchedPeople);
  }
  return {
    ok: true,
    error: "",
    sheetId,
    inserted: data.rows.length,
    skippedCells: data.skippedCells,
    unmatchedPeople: data.unmatchedPeople,
  };
}

async function insertColumns(
  user: SessionUser,
  sheetId: string,
  columns: Array<{ columnId: string; name: string; type: (typeof COLUMN_TYPES)[number]; settings: unknown }>,
): Promise<string | null> {
  if (columns.length === 0) {
    return null;
  }
  const positions = await columnPositions(sheetId, columns.length);
  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index];
    if (!column) {
      continue;
    }
    const result = await applyAndPublish(user, {
      clientOpId: randomUUID(),
      sheetId,
      type: "column.insert",
      payload: {
        columnId: column.columnId,
        name: column.name,
        type: column.type,
        position: positions[index] ?? `z${index}`,
        settings: column.settings,
      },
    });
    if (!result.ok) {
      return result.message;
    }
  }
  return null;
}

async function columnPositions(sheetId: string, count: number): Promise<string[]> {
  const last = await queryOne<{ position: string }>(
    `SELECT position FROM monitor_columns WHERE sheet_id = $1 AND deleted_at IS NULL ORDER BY position DESC LIMIT 1`,
    [sheetId],
  );
  return generateNKeysBetween(last?.position ?? null, null, count);
}

async function rowPositions(sheetId: string, count: number): Promise<string[]> {
  const last = await queryOne<{ position: string }>(
    `SELECT position FROM monitor_rows WHERE sheet_id = $1 AND deleted_at IS NULL ORDER BY position DESC LIMIT 1`,
    [sheetId],
  );
  return generateNKeysBetween(last?.position ?? null, null, count);
}

async function applyAndPublish(user: SessionUser, raw: unknown): Promise<ApplyResult> {
  const result = await applyOp(user, raw);
  if (!result.ok) {
    return result;
  }
  try {
    getIO().to(`sheet:${result.op.sheetId}`).emit("op:applied", {
      op: result.op,
      version: result.version,
      userId: user.id,
      clientOpId: result.op.clientOpId,
      at: new Date().toISOString(),
    });
  } catch {
    console.error("csv import broadcast failed");
  }
  return result;
}
