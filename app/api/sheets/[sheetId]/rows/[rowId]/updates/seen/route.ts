import { connection } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import { sheetExists } from "@/lib/sheets/activity-repo";
import { markUpdateSeen } from "@/lib/updates/repo";

export async function POST(_request: Request, context: { params: Promise<{ sheetId: string; rowId: string }> }) {
  await connection();
  const user = await requireUser();
  if (!can(user.role, "sheet.view")) {
    return Response.json({ error: "You don't have permission to do that." }, { status: 403 });
  }
  const params = await context.params;
  const sheetId = z.uuid().safeParse(params.sheetId);
  const rowId = z.uuid().safeParse(params.rowId);
  if (!sheetId.success || !rowId.success || !(await sheetExists(sheetId.data, user))) {
    return Response.json({ error: "Sheet not found." }, { status: 404 });
  }
  await markUpdateSeen({ sheetId: sheetId.data, rowId: rowId.data, userId: user.id });
  return Response.json({ ok: true });
}
