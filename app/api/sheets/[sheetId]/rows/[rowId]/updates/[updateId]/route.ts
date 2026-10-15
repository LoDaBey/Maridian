import { connection } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import { sheetExists } from "@/lib/sheets/activity-repo";
import { deleteUpdate, editUpdate } from "@/lib/updates/repo";

const bodySchema = z.object({
  body: z.string().trim().min(1, "Write an update.").max(8000),
  mentions: z.array(z.uuid()).max(50).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ sheetId: string; rowId: string; updateId: string }> }) {
  await connection();
  const user = await requireUser();
  if (!can(user.role, "row.insert")) {
    return Response.json({ error: "You don't have permission to do that." }, { status: 403 });
  }
  const parsed = await parseParams(context, user);
  if (!parsed) {
    return Response.json({ error: "Update not found." }, { status: 404 });
  }
  const payload = bodySchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return Response.json({ error: payload.error.issues[0]?.message ?? "Write an update." }, { status: 400 });
  }
  const update = await editUpdate({
    ...parsed,
    authorId: user.id,
    body: payload.data.body,
    mentions: payload.data.mentions ?? [],
  });
  if (!update) {
    return Response.json({ error: "You can only edit your own updates." }, { status: 403 });
  }
  return Response.json({ update });
}

export async function DELETE(_request: Request, context: { params: Promise<{ sheetId: string; rowId: string; updateId: string }> }) {
  await connection();
  const user = await requireUser();
  if (!can(user.role, "row.insert")) {
    return Response.json({ error: "You don't have permission to do that." }, { status: 403 });
  }
  const parsed = await parseParams(context, user);
  if (!parsed) {
    return Response.json({ error: "Update not found." }, { status: 404 });
  }
  const ok = await deleteUpdate({ ...parsed, authorId: user.id });
  if (!ok) {
    return Response.json({ error: "You can only delete your own updates." }, { status: 403 });
  }
  return Response.json({ ok: true });
}

async function parseParams(
  context: { params: Promise<{ sheetId: string; rowId: string; updateId: string }> },
  viewer: { id: string; role: import("@/lib/rbac").Role },
) {
  const params = await context.params;
  const sheetId = z.uuid().safeParse(params.sheetId);
  const rowId = z.uuid().safeParse(params.rowId);
  const updateId = z.uuid().safeParse(params.updateId);
  if (!sheetId.success || !rowId.success || !updateId.success || !(await sheetExists(sheetId.data, viewer))) {
    return null;
  }
  return { sheetId: sheetId.data, rowId: rowId.data, updateId: updateId.data };
}
