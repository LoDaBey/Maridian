import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import { listSheetActivity, sheetExists } from "@/lib/sheets/activity-repo";

export async function GET(request: NextRequest, context: { params: Promise<{ sheetId: string }> }) {
  await connection();
  const user = await requireUser();
  const params = await context.params;
  const sheetId = z.uuid().safeParse(params.sheetId);
  if (!sheetId.success || !(await sheetExists(sheetId.data, user))) {
    return Response.json({ error: "Sheet not found." }, { status: 404 });
  }
  if (!can(user.role, "history.view")) {
    return Response.json({ error: "You don't have permission to do that." }, { status: 403 });
  }

  const beforeRaw = request.nextUrl.searchParams.get("before");
  const userRaw = request.nextUrl.searchParams.get("userId");
  const rowRaw = request.nextUrl.searchParams.get("rowId");
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "50");
  const before = beforeRaw && /^\d+$/.test(beforeRaw) ? beforeRaw : null;
  const userId = z.uuid().safeParse(userRaw ?? "");
  const rowId = z.uuid().safeParse(rowRaw ?? "");
  if (userRaw && !userId.success) {
    return Response.json({ error: "Choose a person." }, { status: 400 });
  }
  if (rowRaw && !rowId.success) {
    return Response.json({ error: "Item not found." }, { status: 400 });
  }
  const page = await listSheetActivity({
    sheetId: sheetId.data,
    before,
    userId: userId.success ? userId.data : null,
    rowId: rowId.success ? rowId.data : null,
    limit: Number.isFinite(limitRaw) ? limitRaw : 50,
  });
  return Response.json(page);
}
