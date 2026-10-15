import { connection } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import { listCellHistory, sheetExists } from "@/lib/sheets/activity-repo";

export async function GET(_request: Request, context: { params: Promise<{ sheetId: string; rowId: string; columnId: string }> }) {
  await connection();
  const user = await requireUser();
  const params = await context.params;
  const sheetId = z.uuid().safeParse(params.sheetId);
  const rowId = z.uuid().safeParse(params.rowId);
  const columnId = z.uuid().safeParse(params.columnId);
  if (!sheetId.success || !rowId.success || !columnId.success || !(await sheetExists(sheetId.data, user))) {
    return Response.json({ error: "Sheet not found." }, { status: 404 });
  }
  if (!can(user.role, "sheet.view")) {
    return Response.json({ error: "You don't have permission to do that." }, { status: 403 });
  }
  const entries = await listCellHistory(sheetId.data, rowId.data, columnId.data);
  return Response.json({ entries });
}
