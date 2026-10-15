import { connection } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import { sheetExists } from "@/lib/sheets/activity-repo";
import { countUpdatesByRow } from "@/lib/updates/repo";

export async function GET(_request: Request, context: { params: Promise<{ sheetId: string }> }) {
  await connection();
  const user = await requireUser();
  if (!can(user.role, "sheet.view")) {
    return Response.json({ error: "You don't have permission to do that." }, { status: 403 });
  }
  const params = await context.params;
  const sheetId = z.uuid().safeParse(params.sheetId);
  if (!sheetId.success || !(await sheetExists(sheetId.data, user))) {
    return Response.json({ error: "Sheet not found." }, { status: 404 });
  }
  return Response.json({ counts: await countUpdatesByRow(sheetId.data) });
}
