import { connection } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import { sheetExists } from "@/lib/sheets/activity-repo";
import { createUpdate, listRowUpdates } from "@/lib/updates/repo";

const bodySchema = z.object({
  body: z.string().trim().min(1, "Write an update.").max(8000),
  mentions: z.array(z.uuid()).max(50).optional(),
  attachments: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string().trim().min(1).max(200),
        url: z.url().max(2000),
      }),
    )
    .max(10)
    .optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ sheetId: string; rowId: string }> }) {
  await connection();
  const user = await requireUser();
  if (!can(user.role, "sheet.view")) {
    return Response.json({ error: "You don't have permission to do that." }, { status: 403 });
  }
  const parsed = await parseParams(context, user);
  if (!parsed) {
    return Response.json({ error: "Sheet not found." }, { status: 404 });
  }
  return Response.json({ updates: await listRowUpdates(parsed.sheetId, parsed.rowId) });
}

export async function POST(request: Request, context: { params: Promise<{ sheetId: string; rowId: string }> }) {
  await connection();
  const user = await requireUser();
  if (!can(user.role, "row.insert")) {
    return Response.json({ error: "You don't have permission to do that." }, { status: 403 });
  }
  const parsed = await parseParams(context, user);
  if (!parsed) {
    return Response.json({ error: "Sheet not found." }, { status: 404 });
  }
  const payload = bodySchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return Response.json({ error: payload.error.issues[0]?.message ?? "Write an update." }, { status: 400 });
  }
  try {
    const update = await createUpdate({
      sheetId: parsed.sheetId,
      rowId: parsed.rowId,
      authorId: user.id,
      body: payload.data.body,
      mentions: payload.data.mentions ?? [],
      attachments: payload.data.attachments,
    });
    return Response.json({ update });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not post the update." }, { status: 400 });
  }
}

async function parseParams(
  context: { params: Promise<{ sheetId: string; rowId: string }> },
  viewer: { id: string; role: import("@/lib/rbac").Role },
) {
  const params = await context.params;
  const sheetId = z.uuid().safeParse(params.sheetId);
  const rowId = z.uuid().safeParse(params.rowId);
  if (!sheetId.success || !rowId.success || !(await sheetExists(sheetId.data, viewer))) {
    return null;
  }
  return { sheetId: sheetId.data, rowId: rowId.data };
}
