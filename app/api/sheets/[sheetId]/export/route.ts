import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { query } from "@/lib/db";
import { can } from "@/lib/rbac";
import { calendarDate, contentDisposition, exportCsv } from "@/lib/sheets/csv";
import type { JsonValue } from "@/lib/sheets/ops";
import { loadSnapshot } from "@/lib/sheets/snapshot";
import { userCanAccessSheet } from "@/lib/sheets/workbook-access";

const bodySchema = z.object({
  scope: z.enum(["all", "view"]),
  rowIds: z.array(z.uuid()).max(10_000).optional(),
});

export async function GET(request: NextRequest, context: { params: Promise<{ sheetId: string }> }) {
  await connection();
  const scope = request.nextUrl.searchParams.get("scope") ?? "all";
  if (scope === "view") {
    return Response.json({ error: "Send the visible row ids with POST." }, { status: 400 });
  }
  if (scope !== "all") {
    return Response.json({ error: "Choose all or view." }, { status: 400 });
  }
  return sendCsv(await context.params, null);
}

export async function POST(request: NextRequest, context: { params: Promise<{ sheetId: string }> }) {
  await connection();
  const json: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Check the export and try again." }, { status: 400 });
  }
  if (parsed.data.scope === "view" && !parsed.data.rowIds) {
    return Response.json({ error: "Send the visible row ids." }, { status: 400 });
  }
  return sendCsv(await context.params, parsed.data.scope === "view" ? parsed.data.rowIds ?? [] : null);
}

async function sendCsv(params: { sheetId: string }, rowIds: string[] | null): Promise<Response> {
  const user = await requireUser();
  if (!can(user.role, "csv.export")) {
    return Response.json({ error: "You don't have permission to do that." }, { status: 403 });
  }
  const sheetId = z.uuid().safeParse(params.sheetId);
  if (!sheetId.success || !(await userCanAccessSheet(user, sheetId.data))) {
    return Response.json({ error: "Sheet not found." }, { status: 404 });
  }
  const snapshot = await loadSnapshot(sheetId.data);
  if (!snapshot) {
    return Response.json({ error: "Sheet not found." }, { status: 404 });
  }

  const byId = new Map(snapshot.rows.map((row) => [row.id, row]));
  const rows = rowIds === null ? snapshot.rows : rowIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
  const users = await query<{ id: string; full_name: string }>(
    `SELECT id, full_name FROM monitor_users`,
  );
  const usersById = new Map(users.map((person) => [person.id, person.full_name]));
  const body = exportCsv(
    snapshot.columns.map((column) => ({
      id: column.id,
      name: column.name,
      type: column.type,
      settings: column.settings,
    })),
    rows.map((row) => ({ data: row.data as Record<string, JsonValue | undefined> })),
    usersById,
  );

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(snapshot.sheet.name, calendarDate(new Date())),
      "Cache-Control": "no-store",
    },
  });
}
