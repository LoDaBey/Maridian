import { connection } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import { listNotifications, unreadCount } from "@/lib/notifications/repo";

export async function GET() {
  await connection();
  const user = await requireUser();
  if (!can(user.role, "sheet.view")) {
    return Response.json({ error: "You don't have permission to do that." }, { status: 403 });
  }
  const [items, unread] = await Promise.all([listNotifications(user.id), unreadCount(user.id)]);
  return Response.json({ notifications: items, unread });
}
