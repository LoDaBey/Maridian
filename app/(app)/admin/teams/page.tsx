import { requirePermission } from "@/lib/auth/current-user";
import { listTeams } from "@/lib/teams/repo";
import { listUsers } from "@/lib/users";
import { TeamsAdmin } from "./_components/TeamsAdmin";

export const instant = false;

export default async function AdminTeamsPage() {
  await requirePermission("team.manage");
  const [teams, users] = await Promise.all([listTeams(), listUsers()]);
  return (
    <TeamsAdmin
      teams={teams}
      people={users
        .filter((user) => user.isActive)
        .map((user) => ({ id: user.id, fullName: user.fullName, email: user.email, avatarColor: user.avatarColor, role: user.role }))}
    />
  );
}
