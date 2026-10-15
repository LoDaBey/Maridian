import { connection } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import { markNotificationsRead } from "@/lib/notifications/repo";

const bodySchema = z.object({
  ids: z.array(z.uuid()).max(100).optional(),
  all: z.boolean().optional(),
});

export async function POST(request: Request) {
  await connection();
  const user = await requireUser();
  if (!can(user.role, "sheet.view")) {
    return Response.json({ error: "You don't have permission to do that." }, { status: 403 });
  }
  const payload = bodySchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return Response.json({ error: "Nothing to mark read." }, { status: 400 });
  }
  await markNotificationsRead(user.id, payload.data.all ? null : (payload.data.ids ?? []));
  return Response.json({ ok: true });
}
