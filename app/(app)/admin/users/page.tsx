import { requirePermission } from "@/lib/auth/current-user";
import { listUsers } from "@/lib/users";
import { UsersAdmin } from "./_components/users-admin";

export const instant = false;

export default async function AdminUsersPage() {
  const actor = await requirePermission("user.manage");
  const users = await listUsers();

  return <UsersAdmin users={users} actorId={actor.id} />;
}
