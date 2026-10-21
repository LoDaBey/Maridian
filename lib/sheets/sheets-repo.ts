import { randomUUID } from "node:crypto";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import type { PoolClient } from "pg";
import { z } from "zod";
import { query, tx } from "@/lib/db";
import { can, type Role } from "@/lib/rbac";
import type {
  ColumnType,
  DeletedWorkbookSummary,
  ImportColumnDraft,
  ImportRowDraft,
  ImportWorkbookTabDraft,
  SavedTemplateColumn,
  SavedTemplateGroup,
  SavedTemplatePayload,
  SavedTemplateTab,
  SheetPreview,
} from "@/lib/db-types";
import { WORKBOOK_PURGE_DAYS } from "@/lib/db-types";
import { loadWorkbookPreviews } from "@/lib/sheets/workbook-preview";
import { addWorkbookMember, visibleTabSql, visibleWorkbooksSql } from "@/lib/sheets/workbook-access";
import {
  columnsForTemplate,
  directionForTemplate,
  rowCountForTemplate,
  type ColumnDraft,
  type SheetDirection,
  type SheetTemplateId,
} from "@/lib/sheets/templates";

export class SheetActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SheetActionError";
  }
}

export interface SheetSummary {
  id: string;
  workbookId: string;
  workbookName: string;
  name: string;
  position: string;
  direction: SheetDirection;
  archivedAt: string | null;
  /** Shown only to some people. */
  hidden?: boolean;
  /** The whole tab is protected. */
  locked?: boolean;
}

export interface SavedTemplateSummary {
  id: string;
  name: string;
}

export interface WorkbookSummary {
  id: string;
  name: string;
  position: string;
  archivedAt: string | null;
  firstTabId: string | null;
  createdBy: string | null;
  preview?: SheetPreview;
}

interface SheetRow {
  id: string;
  workbook_id: string;
  workbook_name: string;
  name: string;
  position: string;
  direction: SheetDirection;
  version: string | number;
  archived_at: Date | null;
  hidden?: boolean;
  locked?: boolean;
}

interface WorkbookRow {
  id: string;
  name: string;
  position: string;
  archived_at: Date | null;
  first_tab_id: string | null;
  created_by: string | null;
}

const SHEET_ORDER_LOCK = 714206;
const WORKBOOK_ORDER_LOCK = 714207;

const SHEET_SELECT = `s.id, s.workbook_id, w.name AS workbook_name, s.name, s.position,
       s.direction, s.version, s.archived_at, (s.visible_to IS NOT NULL) AS hidden,
       EXISTS (SELECT 1 FROM monitor_protections p WHERE p.sheet_id = s.id AND p.scope = 'tab') AS locked`;

function mapSheet(row: SheetRow): SheetSummary {
  return {
    id: row.id,
    workbookId: row.workbook_id,
    workbookName: row.workbook_name,
    name: row.name,
    position: row.position,
    direction: row.direction,
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
    hidden: row.hidden ?? false,
    locked: row.locked ?? false,
  };
}

function mapWorkbook(row: WorkbookRow): WorkbookSummary {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
    firstTabId: row.first_tab_id,
    createdBy: row.created_by,
  };
}

function isUuid(value: string): boolean {
  return z.uuid().safeParse(value).success;
}

async function lockSheetOrder(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [SHEET_ORDER_LOCK]);
}

async function lockWorkbookOrder(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [WORKBOOK_ORDER_LOCK]);
}

async function nextTabPosition(client: PoolClient, workbookId: string): Promise<string> {
  const last = await client.query<{ position: string }>(
    `SELECT position
     FROM monitor_sheets
     WHERE workbook_id = $1 AND archived_at IS NULL
     ORDER BY position DESC
     LIMIT 1`,
    [workbookId],
  );
  return generateKeyBetween(last.rows[0]?.position ?? null, null);
}

async function nextWorkbookPosition(client: PoolClient): Promise<string> {
  const last = await client.query<{ position: string }>(
    `SELECT position
     FROM monitor_workbooks
     WHERE archived_at IS NULL
     ORDER BY position DESC
     LIMIT 1`,
  );
  return generateKeyBetween(last.rows[0]?.position ?? null, null);
}

async function audit(
  client: PoolClient,
  sheetId: string,
  userId: string,
  action: string,
  newValue: Record<string, unknown>,
  version: number,
): Promise<void> {
  await client.query(
    `INSERT INTO monitor_activity_log (sheet_id, user_id, action, new_value, sheet_version)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [sheetId, userId, action, JSON.stringify(newValue), version],
  );
}

async function lockSheet(client: PoolClient, id: string): Promise<SheetRow | null> {
  const result = await client.query<SheetRow>(
    `SELECT ${SHEET_SELECT}
     FROM monitor_sheets s
     JOIN monitor_workbooks w ON w.id = s.workbook_id
     WHERE s.id = $1
     FOR UPDATE OF s`,
    [id],
  );
  return result.rows[0] ?? null;
}

async function insertTab(
  client: PoolClient,
  input: {
    workbookId: string;
    actorId: string;
    name: string;
    template: SheetTemplateId;
  },
): Promise<string> {
  const id = randomUUID();
  const direction = directionForTemplate(input.template);
  const position = await nextTabPosition(client, input.workbookId);
  await client.query(
    `INSERT INTO monitor_sheets (id, workbook_id, name, position, direction, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, input.workbookId, input.name, position, direction, input.actorId],
  );
  await insertColumns(client, id, input.actorId, columnsForTemplate(input.template));
  const groupId = await insertGroups(client, id, input.actorId, [{ name: "Items", color: "#579bfc" }]);
  await insertEmptyRows(client, id, input.actorId, groupId, rowCountForTemplate(input.template));
  await audit(
    client,
    id,
    input.actorId,
    "sheet.create",
    { name: input.name, template: input.template, direction, workbookId: input.workbookId },
    0,
  );
  return id;
}

async function insertTabFromSnapshot(
  client: PoolClient,
  input: {
    workbookId: string;
    actorId: string;
    tab: SavedTemplateTab;
  },
): Promise<string> {
  const id = randomUUID();
  const position = await nextTabPosition(client, input.workbookId);
  await client.query(
    `INSERT INTO monitor_sheets (id, workbook_id, name, position, direction, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, input.workbookId, input.tab.name, position, input.tab.direction, input.actorId],
  );
  await insertColumns(client, id, input.actorId, input.tab.columns as ColumnDraft[]);
  const groups = input.tab.groups?.length ? input.tab.groups : [{ name: "Items", color: "#579bfc" }];
  const groupId = await insertGroups(client, id, input.actorId, groups);
  await insertEmptyRows(client, id, input.actorId, groupId, input.tab.rowCount);
  await audit(
    client,
    id,
    input.actorId,
    "sheet.create",
    {
      name: input.tab.name,
      direction: input.tab.direction,
      workbookId: input.workbookId,
      fromTemplate: true,
    },
    0,
  );
  return id;
}

async function insertColumns(
  client: PoolClient,
  sheetId: string,
  actorId: string,
  columns: ColumnDraft[],
): Promise<void> {
  if (columns.length === 0) {
    return;
  }
  const positions = generateNKeysBetween(null, null, columns.length);

  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index];
    if (!column) {
      continue;
    }
    await client.query(
      `INSERT INTO monitor_columns (
         id, sheet_id, name, type, position, width, settings, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        column.id ?? randomUUID(),
        sheetId,
        column.name,
        column.type,
        positions[index],
        column.width,
        JSON.stringify(column.settings),
        actorId,
      ],
    );
  }
}

async function insertGroups(
  client: PoolClient,
  sheetId: string,
  actorId: string,
  groups: SavedTemplateGroup[],
): Promise<string> {
  const positions = generateNKeysBetween(null, null, Math.max(1, groups.length));
  let firstId = "";
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (!group) {
      continue;
    }
    const id = randomUUID();
    if (!firstId) {
      firstId = id;
    }
    await client.query(
      `INSERT INTO monitor_groups (id, sheet_id, name, color, position, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, sheetId, group.name, group.color, positions[index], actorId],
    );
  }
  return firstId;
}

async function insertEmptyRows(
  client: PoolClient,
  sheetId: string,
  actorId: string,
  groupId: string,
  count: number,
): Promise<void> {
  if (count <= 0) {
    return;
  }

  const positions = generateNKeysBetween(null, null, count);
  for (let index = 0; index < count; index += 1) {
    await client.query(
      `INSERT INTO monitor_rows (id, sheet_id, group_id, item_number, position, data, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $6)`,
      [randomUUID(), sheetId, groupId, index + 1, positions[index], actorId],
    );
  }
}

export async function listActiveSheets(viewer: { id: string; role: Role }): Promise<SheetSummary[]> {
  const rows = await query<SheetRow>(
    `SELECT ${SHEET_SELECT}
     FROM monitor_sheets s
     JOIN monitor_workbooks w ON w.id = s.workbook_id
     WHERE s.archived_at IS NULL AND w.archived_at IS NULL AND w.deleted_at IS NULL
       AND ${visibleWorkbooksSql(viewer)} AND ${visibleTabSql(viewer)}
     ORDER BY s.position`,
    [viewer.id],
  );
  return rows.map(mapSheet);
}

export async function listTabs(workbookId: string): Promise<SheetSummary[]> {
  if (!isUuid(workbookId)) {
    return [];
  }
  const rows = await query<SheetRow>(
    `SELECT ${SHEET_SELECT}
     FROM monitor_sheets s
     JOIN monitor_workbooks w ON w.id = s.workbook_id
     WHERE s.workbook_id = $1 AND s.archived_at IS NULL AND w.archived_at IS NULL AND w.deleted_at IS NULL
     ORDER BY s.position`,
    [workbookId],
  );
  return rows.map(mapSheet);
}

export async function listArchivedSheets(viewer: { id: string; role: Role }): Promise<SheetSummary[]> {
  const rows = await query<SheetRow>(
    `SELECT ${SHEET_SELECT}
     FROM monitor_sheets s
     JOIN monitor_workbooks w ON w.id = s.workbook_id
     WHERE s.archived_at IS NOT NULL AND w.deleted_at IS NULL
       AND ${visibleWorkbooksSql(viewer)} AND ${visibleTabSql(viewer)}
     ORDER BY s.archived_at DESC`,
    [viewer.id],
  );
  return rows.map(mapSheet);
}

/** The first tab is the first one this viewer can see (`$1` = viewer id). */
function workbookSelect(viewer: { id: string; role: Role }): string {
  return `SELECT w.id, w.name, w.position, w.archived_at, w.created_by,
         (
           SELECT s.id
           FROM monitor_sheets s
           WHERE s.workbook_id = w.id AND s.archived_at IS NULL AND ${visibleTabSql(viewer)}
           ORDER BY s.position
           LIMIT 1
         ) AS first_tab_id
  FROM monitor_workbooks w`;
}

/** Sheets in one workspace that the viewer can open. */
export async function listWorkbooks(
  viewer: { id: string; role: Role },
  workspaceId: string,
): Promise<WorkbookSummary[]> {
  if (!isUuid(workspaceId)) {
    return [];
  }
  const rows = await query<WorkbookRow>(
    `${workbookSelect(viewer)}
     WHERE w.workspace_id = $2 AND w.archived_at IS NULL AND w.deleted_at IS NULL
       AND ${visibleWorkbooksSql(viewer)}
     ORDER BY w.position`,
    [viewer.id, workspaceId],
  );
  const workbooks = rows.map(mapWorkbook);
  const previews = await loadWorkbookPreviews(workbooks.map((workbook) => workbook.id), viewer);
  return workbooks.map((workbook) => ({
    ...workbook,
    preview: previews.get(workbook.id) ?? { direction: "ltr", columns: [], rows: [] },
  }));
}

export async function listArchivedWorkbooks(
  viewer: { id: string; role: Role },
  workspaceId: string,
): Promise<WorkbookSummary[]> {
  if (!isUuid(workspaceId)) {
    return [];
  }
  const rows = await query<WorkbookRow>(
    `SELECT w.id, w.name, w.position, w.archived_at, w.created_by,
            (
              SELECT s.id
              FROM monitor_sheets s
              WHERE s.workbook_id = w.id AND ${visibleTabSql(viewer)}
              ORDER BY s.position
              LIMIT 1
            ) AS first_tab_id
     FROM monitor_workbooks w
     WHERE w.workspace_id = $2 AND w.archived_at IS NOT NULL AND w.deleted_at IS NULL
       AND ${visibleWorkbooksSql(viewer)}
     ORDER BY w.archived_at DESC`,
    [viewer.id, workspaceId],
  );
  return rows.map(mapWorkbook);
}

export async function listDeletedWorkbooks(): Promise<DeletedWorkbookSummary[]> {
  const rows = await query<{
    id: string;
    name: string;
    created_by: string | null;
    created_by_name: string | null;
    deleted_at: Date;
    deleted_by: string | null;
    deleted_by_name: string | null;
  }>(
    `SELECT w.id, w.name, w.created_by, w.deleted_at, w.deleted_by,
            owner.full_name AS created_by_name,
            actor.full_name AS deleted_by_name
     FROM monitor_workbooks w
     LEFT JOIN monitor_users owner ON owner.id = w.created_by
     LEFT JOIN monitor_users actor ON actor.id = w.deleted_by
     WHERE w.deleted_at IS NOT NULL
     ORDER BY w.deleted_at DESC`,
  );
  return rows.map((row) => {
    const purgeAt = new Date(row.deleted_at.getTime() + WORKBOOK_PURGE_DAYS * 24 * 60 * 60 * 1000);
    return {
      id: row.id,
      name: row.name,
      createdBy: row.created_by,
      createdByName: row.created_by_name ?? "Unknown",
      deletedAt: row.deleted_at.toISOString(),
      deletedBy: row.deleted_by,
      deletedByName: row.deleted_by_name ?? "Unknown",
      purgeAt: purgeAt.toISOString(),
      canPurge: purgeAt.getTime() <= Date.now(),
    };
  });
}

export async function softDeleteWorkbookRecord(input: {
  actorId: string;
  id: string;
}): Promise<void> {
  if (!isUuid(input.id)) {
    throw new SheetActionError("Sheet not found.");
  }
  await tx(async (client) => {
    const workbook = await client.query<{
      id: string;
      created_by: string | null;
      deleted_at: Date | null;
    }>(
      `SELECT id, created_by, deleted_at
       FROM monitor_workbooks
       WHERE id = $1
       FOR UPDATE`,
      [input.id],
    );
    const row = workbook.rows[0];
    if (!row || row.deleted_at) {
      throw new SheetActionError("Sheet not found.");
    }
    const actor = await client.query<{ role: Role }>(
      `SELECT role FROM monitor_users WHERE id = $1`,
      [input.actorId],
    );
    const role = actor.rows[0]?.role;
    const allowed =
      row.created_by === input.actorId || (role !== undefined && can(role, "sheet.purge"));
    if (!allowed) {
      throw new SheetActionError("Only the owner can delete this sheet.");
    }
    await client.query(
      `UPDATE monitor_workbooks
       SET deleted_at = now(), deleted_by = $2
       WHERE id = $1`,
      [input.id, input.actorId],
    );
    const tab = await client.query<{ id: string; version: string | number }>(
      `SELECT id, version FROM monitor_sheets WHERE workbook_id = $1 ORDER BY position LIMIT 1`,
      [input.id],
    );
    if (tab.rows[0]) {
      await audit(
        client,
        tab.rows[0].id,
        input.actorId,
        "workbook.delete",
        { workbookId: input.id, deleted: true },
        Number(tab.rows[0].version),
      );
    }
  });
}

export async function purgeWorkbookRecord(input: {
  actorId: string;
  id: string;
}): Promise<void> {
  if (!isUuid(input.id)) {
    throw new SheetActionError("Sheet not found.");
  }
  await tx(async (client) => {
    const workbook = await client.query<{ id: string; deleted_at: Date | null }>(
      `SELECT id, deleted_at
       FROM monitor_workbooks
       WHERE id = $1
       FOR UPDATE`,
      [input.id],
    );
    const row = workbook.rows[0];
    if (!row || !row.deleted_at) {
      throw new SheetActionError("Sheet not found.");
    }
    const purgeAt = row.deleted_at.getTime() + WORKBOOK_PURGE_DAYS * 24 * 60 * 60 * 1000;
    if (purgeAt > Date.now()) {
      throw new SheetActionError("This sheet can be deleted for good after 30 days.");
    }
    await client.query(`DELETE FROM monitor_workbooks WHERE id = $1`, [input.id]);
  });
}

export async function getSheet(id: string): Promise<SheetSummary | null> {
  if (!isUuid(id)) {
    return null;
  }

  const row = await query<SheetRow>(
    `SELECT ${SHEET_SELECT}
     FROM monitor_sheets s
     JOIN monitor_workbooks w ON w.id = s.workbook_id
     WHERE s.id = $1 AND w.deleted_at IS NULL`,
    [id],
  );
  const sheet = row[0];
  return sheet ? mapSheet(sheet) : null;
}

export async function createWorkbookFromImport(input: {
  actorId: string;
  workspaceId: string;
  name: string;
  tabs: ImportWorkbookTabDraft[];
}): Promise<{ id: string; tabs: Array<{ sheetId: string; name: string }> }> {
  if (input.tabs.length === 0) {
    throw new SheetActionError("Import at least one tab.");
  }
  return tx(async (client) => {
    await lockWorkbookOrder(client);
    await lockSheetOrder(client);
    const workbookId = randomUUID();
    const position = await nextWorkbookPosition(client);
    await client.query(
      `INSERT INTO monitor_workbooks (id, name, position, created_by, workspace_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [workbookId, input.name, position, input.actorId, input.workspaceId],
    );
    await addWorkbookMember(client, {
      workbookId,
      userId: input.actorId,
      addedBy: input.actorId,
      role: "owner",
    });
    const createdTabs: Array<{ sheetId: string; name: string }> = [];
    let firstId: string | null = null;
    for (const tab of input.tabs) {
      const id = randomUUID();
      const tabName = tab.name.trim() || `Tab ${createdTabs.length + 1}`;
      await client.query(
        `INSERT INTO monitor_sheets (id, workbook_id, name, position, direction, created_by)
         VALUES ($1, $2, $3, $4, 'rtl', $5)`,
        [id, workbookId, tabName, await nextTabPosition(client, workbookId), input.actorId],
      );
      await insertColumns(
        client,
        id,
        input.actorId,
        tab.columns.map((column) => ({
          id: column.id,
          name: column.name,
          type: column.type,
          width: 180,
          settings: column.settings,
        })),
      );
      const groupId = await insertGroups(client, id, input.actorId, [{ name: "Items", color: "#579bfc" }]);
      const positions = generateNKeysBetween(null, null, tab.rows.length);
      for (let index = 0; index < tab.rows.length; index += 1) {
        const row = tab.rows[index];
        if (!row) {
          continue;
        }
        await client.query(
          `INSERT INTO monitor_rows (id, sheet_id, group_id, item_number, position, data, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)`,
          [
            row.id,
            id,
            groupId,
            index + 1,
            positions[index],
            JSON.stringify(row.data),
            input.actorId,
          ],
        );
      }
      await audit(
        client,
        id,
        input.actorId,
        "sheet.create",
        {
          name: tabName,
          template: "import",
          direction: "rtl",
          workbookId,
          rows: tab.rows.length,
        },
        0,
      );
      createdTabs.push({ sheetId: id, name: tabName });
      firstId ??= id;
    }
    if (!firstId) {
      throw new SheetActionError("Import at least one tab.");
    }
    return { id: firstId, tabs: createdTabs };
  });
}

export async function createWorkbookRecord(input: {
  actorId: string;
  workspaceId: string;
  name: string;
  template: SheetTemplateId;
}): Promise<{ id: string }> {
  return tx(async (client) => {
    await lockWorkbookOrder(client);
    await lockSheetOrder(client);
    const workbookId = randomUUID();
    const position = await nextWorkbookPosition(client);
    await client.query(
      `INSERT INTO monitor_workbooks (id, name, position, created_by, workspace_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [workbookId, input.name, position, input.actorId, input.workspaceId],
    );
    await addWorkbookMember(client, {
      workbookId,
      userId: input.actorId,
      addedBy: input.actorId,
      role: "owner",
    });
    const id = await insertTab(client, {
      workbookId,
      actorId: input.actorId,
      name: "Tab 1",
      template: input.template,
    });
    return { id };
  });
}

export async function createTabRecord(input: {
  actorId: string;
  workbookId: string;
  name: string;
  template: SheetTemplateId;
}): Promise<{ id: string }> {
  return tx(async (client) => {
    await lockSheetOrder(client);
    const workbook = await client.query<{ id: string; archived_at: Date | null }>(
      `SELECT id, archived_at FROM monitor_workbooks WHERE id = $1 FOR UPDATE`,
      [input.workbookId],
    );
    if (!workbook.rows[0] || workbook.rows[0].archived_at) {
      throw new SheetActionError("Sheet not found.");
    }
    const id = await insertTab(client, {
      workbookId: input.workbookId,
      actorId: input.actorId,
      name: input.name,
      template: input.template,
    });
    return { id };
  });
}

export async function listSheetTemplates(): Promise<SavedTemplateSummary[]> {
  const rows = await query<{ id: string; name: string }>(
    `SELECT id, name
     FROM monitor_sheet_templates
     ORDER BY created_at DESC`,
  );
  return rows;
}

export async function deleteSheetTemplateRecord(input: { id: string }): Promise<void> {
  if (!isUuid(input.id)) {
    throw new SheetActionError("Template not found.");
  }
  const deleted = await query<{ id: string }>(
    `DELETE FROM monitor_sheet_templates WHERE id = $1 RETURNING id`,
    [input.id],
  );
  if (!deleted[0]) {
    throw new SheetActionError("Template not found.");
  }
}

export async function saveWorkbookAsTemplate(input: {
  actorId: string;
  workbookId: string;
  name: string;
}): Promise<{ id: string }> {
  if (!isUuid(input.workbookId)) {
    throw new SheetActionError("Sheet not found.");
  }

  const workbook = await query<{ id: string; archived_at: Date | null }>(
    `SELECT id, archived_at FROM monitor_workbooks WHERE id = $1`,
    [input.workbookId],
  );
  if (!workbook[0] || workbook[0].archived_at) {
    throw new SheetActionError("Sheet not found.");
  }

  const tabs = await query<{
    id: string;
    name: string;
    direction: SheetDirection;
  }>(
    `SELECT id, name, direction
     FROM monitor_sheets
     WHERE workbook_id = $1 AND archived_at IS NULL
     ORDER BY position`,
    [input.workbookId],
  );
  if (tabs.length === 0) {
    throw new SheetActionError("This sheet has no tabs to save.");
  }

  const snapshotTabs: SavedTemplateTab[] = [];
  for (const tab of tabs) {
    const columns = await query<{
      name: string;
      type: ColumnType;
      width: number;
      settings: Record<string, unknown>;
    }>(
      `SELECT name, type, width, settings
       FROM monitor_columns
       WHERE sheet_id = $1 AND deleted_at IS NULL
       ORDER BY position`,
      [tab.id],
    );
    const count = await query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM monitor_rows
       WHERE sheet_id = $1 AND deleted_at IS NULL`,
      [tab.id],
    );
    const groups = await query<{ name: string; color: string }>(
      `SELECT name, color
       FROM monitor_groups
       WHERE sheet_id = $1 AND deleted_at IS NULL
       ORDER BY position`,
      [tab.id],
    );
    snapshotTabs.push({
      name: tab.name,
      direction: tab.direction,
      columns: columns.map((column): SavedTemplateColumn => ({
        name: column.name,
        type: column.type,
        width: column.width,
        settings: column.settings ?? {},
      })),
      rowCount: Math.max(0, Number(count[0]?.count ?? 0)),
      groups: groups.map((group): SavedTemplateGroup => ({ name: group.name, color: group.color })),
    });
  }

  const payload: SavedTemplatePayload = { tabs: snapshotTabs };
  const created = await query<{ id: string }>(
    `INSERT INTO monitor_sheet_templates (name, payload, created_by)
     VALUES ($1, $2::jsonb, $3)
     RETURNING id`,
    [input.name, JSON.stringify(payload), input.actorId],
  );
  const id = created[0]?.id;
  if (!id) {
    throw new SheetActionError("Could not save the template.");
  }
  return { id };
}

export async function createWorkbookFromSavedTemplate(input: {
  actorId: string;
  workspaceId: string;
  name: string;
  templateId: string;
}): Promise<{ id: string }> {
  if (!isUuid(input.templateId)) {
    throw new SheetActionError("Template not found.");
  }

  const saved = await query<{ payload: SavedTemplatePayload }>(
    `SELECT payload FROM monitor_sheet_templates WHERE id = $1`,
    [input.templateId],
  );
  const tabs = saved[0]?.payload?.tabs;
  if (!tabs || tabs.length === 0) {
    throw new SheetActionError("Template not found.");
  }

  return tx(async (client) => {
    await lockWorkbookOrder(client);
    await lockSheetOrder(client);
    const workbookId = randomUUID();
    const position = await nextWorkbookPosition(client);
    await client.query(
      `INSERT INTO monitor_workbooks (id, name, position, created_by, workspace_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [workbookId, input.name, position, input.actorId, input.workspaceId],
    );
    await addWorkbookMember(client, {
      workbookId,
      userId: input.actorId,
      addedBy: input.actorId,
      role: "owner",
    });
    let firstId: string | null = null;
    for (const tab of tabs) {
      const id = await insertTabFromSnapshot(client, {
        workbookId,
        actorId: input.actorId,
        tab: {
          name: tab.name.trim() || "Tab 1",
          direction: tab.direction === "ltr" ? "ltr" : "rtl",
          columns: Array.isArray(tab.columns) ? tab.columns : [],
          rowCount: Number.isFinite(tab.rowCount) ? Math.max(0, tab.rowCount) : 0,
        },
      });
      firstId ??= id;
    }
    if (!firstId) {
      throw new SheetActionError("Template not found.");
    }
    return { id: firstId };
  });
}

export async function renameSheetRecord(input: {
  actorId: string;
  id: string;
  name: string;
}): Promise<boolean> {
  return tx(async (client) => {
    const sheet = await lockSheet(client, input.id);
    if (!sheet || sheet.archived_at) {
      throw new SheetActionError("Sheet not found.");
    }
    if (sheet.name === input.name) {
      return false;
    }

    const updated = await client.query<{ version: string | number }>(
      `UPDATE monitor_sheets
       SET name = $2, version = version + 1
       WHERE id = $1
       RETURNING version`,
      [input.id, input.name],
    );
    const version = Number(updated.rows[0]?.version ?? 0);
    await audit(client, input.id, input.actorId, "sheet.rename", { name: input.name }, version);
    return true;
  });
}

export async function setSheetDirectionRecord(input: {
  actorId: string;
  id: string;
  direction: SheetDirection;
}): Promise<boolean> {
  return tx(async (client) => {
    const sheet = await lockSheet(client, input.id);
    if (!sheet || sheet.archived_at) {
      throw new SheetActionError("Sheet not found.");
    }
    if (sheet.direction === input.direction) {
      return false;
    }

    const updated = await client.query<{ version: string | number }>(
      `UPDATE monitor_sheets
       SET direction = $2, version = version + 1
       WHERE id = $1
       RETURNING version`,
      [input.id, input.direction],
    );
    const version = Number(updated.rows[0]?.version ?? 0);
    await audit(
      client,
      input.id,
      input.actorId,
      "sheet.direction",
      { direction: input.direction },
      version,
    );
    return true;
  });
}

export async function moveSheetRecord(input: {
  actorId: string;
  id: string;
  beforeId?: string;
  afterId?: string;
}): Promise<void> {
  await tx(async (client) => {
    await lockSheetOrder(client);
    const currentSheet = await lockSheet(client, input.id);
    if (!currentSheet || currentSheet.archived_at) {
      throw new SheetActionError("Sheet not found.");
    }
    const rows = await client.query<{ id: string; position: string; archived_at: Date | null }>(
      `SELECT id, position, archived_at
       FROM monitor_sheets
       WHERE workbook_id = $1 AND archived_at IS NULL
       ORDER BY position
       FOR UPDATE`,
      [currentSheet.workbook_id],
    );
    const current = rows.rows.find((sheet) => sheet.id === input.id);
    if (!current) {
      throw new SheetActionError("Sheet not found.");
    }

    const anchorId = input.beforeId ?? input.afterId;
    if (!anchorId || anchorId === input.id) {
      throw new SheetActionError("Choose another sheet.");
    }

    const others = rows.rows.filter((sheet) => sheet.id !== input.id);
    const anchorIndex = others.findIndex((sheet) => sheet.id === anchorId);
    const anchor = others[anchorIndex];
    if (!anchor) {
      throw new SheetActionError("Sheet not found.");
    }

    const lower = input.beforeId
      ? (others[anchorIndex - 1]?.position ?? null)
      : anchor.position;
    const upper = input.beforeId
      ? anchor.position
      : (others[anchorIndex + 1]?.position ?? null);
    const position = generateKeyBetween(lower, upper);

    await client.query("UPDATE monitor_sheets SET position = $2 WHERE id = $1", [
      input.id,
      position,
    ]);
    const version = Number(
      (await lockSheet(client, input.id))?.version ?? 0,
    );
    await audit(
      client,
      input.id,
      input.actorId,
      "sheet.reorder",
      {
        position,
        beforeId: input.beforeId ?? null,
        afterId: input.afterId ?? null,
      },
      version,
    );
  });
}

export async function archiveSheetRecord(input: {
  actorId: string;
  id: string;
}): Promise<{ nextTabId: string | null; workbookArchived: boolean }> {
  return tx(async (client) => {
    const sheet = await lockSheet(client, input.id);
    if (!sheet || sheet.archived_at) {
      throw new SheetActionError("Sheet not found.");
    }

    await client.query(
      `UPDATE monitor_sheets
       SET archived_at = now(), archived_by = $2
       WHERE id = $1`,
      [input.id, input.actorId],
    );
    await audit(
      client,
      input.id,
      input.actorId,
      "sheet.archive",
      { archived: true },
      Number(sheet.version),
    );

    const remaining = await client.query<{ id: string }>(
      `SELECT id
       FROM monitor_sheets
       WHERE workbook_id = $1 AND archived_at IS NULL
       ORDER BY position`,
      [sheet.workbook_id],
    );
    if (remaining.rows.length === 0) {
      await client.query(
        `UPDATE monitor_workbooks
         SET archived_at = now(), archived_by = $2
         WHERE id = $1`,
        [sheet.workbook_id, input.actorId],
      );
      return { nextTabId: null, workbookArchived: true };
    }
    return { nextTabId: remaining.rows[0]?.id ?? null, workbookArchived: false };
  });
}

export async function restoreSheetRecord(input: {
  actorId: string;
  id: string;
}): Promise<void> {
  await tx(async (client) => {
    await lockSheetOrder(client);
    const sheet = await lockSheet(client, input.id);
    if (!sheet || !sheet.archived_at) {
      throw new SheetActionError("Sheet not found.");
    }

    await client.query(
      `UPDATE monitor_workbooks
       SET archived_at = NULL, archived_by = NULL
       WHERE id = $1 AND archived_at IS NOT NULL`,
      [sheet.workbook_id],
    );
    const position = await nextTabPosition(client, sheet.workbook_id);
    await client.query(
      `UPDATE monitor_sheets
       SET archived_at = NULL, archived_by = NULL, position = $2
       WHERE id = $1`,
      [input.id, position],
    );
    await audit(
      client,
      input.id,
      input.actorId,
      "sheet.restore",
      { archived: false, position },
      Number(sheet.version),
    );
  });
}

export async function restoreWorkbookRecord(input: {
  actorId: string;
  id: string;
}): Promise<{ firstTabId: string | null }> {
  return tx(async (client) => {
    await lockWorkbookOrder(client);
    await lockSheetOrder(client);
    const workbook = await client.query<{ id: string; archived_at: Date | null }>(
      `SELECT id, archived_at FROM monitor_workbooks WHERE id = $1 FOR UPDATE`,
      [input.id],
    );
    if (!workbook.rows[0] || !workbook.rows[0].archived_at) {
      throw new SheetActionError("Sheet not found.");
    }

    await client.query(
      `UPDATE monitor_workbooks
       SET archived_at = NULL, archived_by = NULL
       WHERE id = $1`,
      [input.id],
    );
    const tabs = await client.query<{ id: string }>(
      `SELECT id FROM monitor_sheets WHERE workbook_id = $1 FOR UPDATE`,
      [input.id],
    );
    let position: string | null = null;
    for (const tab of tabs.rows) {
      position = generateKeyBetween(position, null);
      await client.query(
        `UPDATE monitor_sheets
         SET archived_at = NULL, archived_by = NULL, position = $2
         WHERE id = $1`,
        [tab.id, position],
      );
    }
    return { firstTabId: tabs.rows[0]?.id ?? null };
  });
}

function remapData(
  data: unknown,
  columnIds: Map<string, string>,
): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {};
  }

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const mapped = columnIds.get(key);
    if (mapped) {
      next[mapped] = value;
    }
  }
  return next;
}

export async function duplicateSheetRecord(input: {
  actorId: string;
  id: string;
  name: string;
  withRows: boolean;
}): Promise<{ id: string }> {
  return tx(async (client) => {
    await lockSheetOrder(client);
    const source = await lockSheet(client, input.id);
    if (!source || source.archived_at) {
      throw new SheetActionError("Sheet not found.");
    }

    const id = randomUUID();
    const position = await nextTabPosition(client, source.workbook_id);
    await client.query(
      `INSERT INTO monitor_sheets (id, workbook_id, name, position, direction, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, source.workbook_id, input.name, position, source.direction, input.actorId],
    );

    const columns = await client.query<{
      id: string;
      name: string;
      type: string;
      position: string;
      width: number;
      settings: Record<string, unknown>;
    }>(
      `SELECT id, name, type, position, width, settings
       FROM monitor_columns
       WHERE sheet_id = $1 AND deleted_at IS NULL
       ORDER BY position`,
      [input.id],
    );
    const columnIds = new Map<string, string>();
    for (const column of columns.rows) {
      const nextId = randomUUID();
      columnIds.set(column.id, nextId);
      await client.query(
        `INSERT INTO monitor_columns (
           id, sheet_id, name, type, position, width, settings, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [
          nextId,
          id,
          column.name,
          column.type,
          column.position,
          column.width,
          JSON.stringify(column.settings ?? {}),
          input.actorId,
        ],
      );
    }

    const groups = await client.query<{
      id: string;
      name: string;
      color: string;
      position: string;
    }>(
      `SELECT id, name, color, position
       FROM monitor_groups
       WHERE sheet_id = $1 AND deleted_at IS NULL
       ORDER BY position`,
      [input.id],
    );
    const groupIds = new Map<string, string>();
    let firstGroupId = "";
    for (const group of groups.rows) {
      const nextId = randomUUID();
      groupIds.set(group.id, nextId);
      if (!firstGroupId) {
        firstGroupId = nextId;
      }
      await client.query(
        `INSERT INTO monitor_groups (id, sheet_id, name, color, position, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [nextId, id, group.name, group.color, group.position, input.actorId],
      );
    }
    if (!firstGroupId) {
      firstGroupId = await insertGroups(client, id, input.actorId, [{ name: "Items", color: "#579bfc" }]);
    }

    if (input.withRows) {
      const rows = await client.query<{
        position: string;
        data: unknown;
        group_id: string | null;
        item_number: number | null;
      }>(
        `SELECT position, data, group_id, item_number
         FROM monitor_rows
         WHERE sheet_id = $1 AND deleted_at IS NULL
         ORDER BY position`,
        [input.id],
      );
      let itemNumber = 1;
      for (const row of rows.rows) {
        await client.query(
          `INSERT INTO monitor_rows (id, sheet_id, group_id, item_number, position, data, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)`,
          [
            randomUUID(),
            id,
            (row.group_id && groupIds.get(row.group_id)) || firstGroupId,
            row.item_number ?? itemNumber,
            row.position,
            JSON.stringify(remapData(row.data, columnIds)),
            input.actorId,
          ],
        );
        itemNumber += 1;
      }
    }

    await audit(
      client,
      id,
      input.actorId,
      "sheet.duplicate",
      { sourceId: input.id, name: input.name, withRows: input.withRows },
      0,
    );
    return { id };
  });
}
