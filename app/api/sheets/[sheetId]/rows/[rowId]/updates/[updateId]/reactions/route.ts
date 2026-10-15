import { connection } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import { sheetExists } from "@/lib/sheets/activity-repo";
import { toggleReaction } from "@/lib/updates/repo";

export async function POST(
  _request: Request,
  context: { params: Promise<{ sheetId: string; rowId: string; updateId: string }> },
) {
  await connection();
  const user = await requireUser();
  if (!can(user.role, "row.insert")) {
    return Response.json({ error: "You don't have permission to do that." }, { status: 403 });
  }
  const params = await context.params;
  const sheetId = z.uuid().safeParse(params.sheetId);
  const rowId = z.uuid().safeParse(params.rowId);
  const updateId = z.uuid().safeParse(params.updateId);
  if (!sheetId.success || !rowId.success || !updateId.success || !(await sheetExists(sheetId.data, user))) {
    return Response.json({ error: "Update not found." }, { status: 404 });
  }
  const update = await toggleReaction({
    sheetId: sheetId.data,
    rowId: rowId.data,
    updateId: updateId.data,
    userId: user.id,
  });
  if (!update) {
    return Response.json({ error: "Update not found." }, { status: 404 });
  }
  return Response.json({ update });
}
