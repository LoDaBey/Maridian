import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import { listMyInvitations, listMyWorkspaces } from "@/lib/workspaces/repo";
import { NoWorkspace } from "./_components/workspace/NoWorkspace";

export const instant = false;

/** Opens the last workspace used, or the first one the user belongs to. */
export default async function HomePage() {
  const user = await requireUser();
  const workspaces = await listMyWorkspaces(user);
  if (workspaces.length > 0) {
    const last = (await cookies()).get("monitor_ws")?.value;
    const target = workspaces.find((workspace) => workspace.id === last) ?? workspaces[0]!;
    redirect(`/w/${target.id}`);
  }
  const invitations = await listMyInvitations(user.id);
  return <NoWorkspace invitations={invitations} canCreate={can(user.role, "workspace.create")} />;
}
