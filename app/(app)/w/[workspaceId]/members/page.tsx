import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import {
  getWorkspace,
  isWorkspaceManager,
  listInvitableUsers,
  listPendingInvitations,
  listWorkspaceMembers,
} from "@/lib/workspaces/repo";
import { WorkspaceMembers } from "../../../_components/workspace/WorkspaceMembers";

export const instant = false;

export default async function WorkspaceMembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const [{ workspaceId }, { invite }] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const workspace = await getWorkspace(user, workspaceId);
  if (!workspace) {
    notFound();
  }
  const canManage = isWorkspaceManager(workspace.role);
  const canInvite = canManage || (workspace.isMember && can(user.role, "workspace.invite"));
  const [members, invitations, invitable] = await Promise.all([
    listWorkspaceMembers(workspace.id),
    canManage ? listPendingInvitations(workspace.id) : Promise.resolve([]),
    canInvite ? listInvitableUsers(workspace.id) : Promise.resolve([]),
  ]);

  return (
    <WorkspaceMembers
      workspace={workspace}
      members={members}
      invitations={invitations}
      invitable={invitable}
      currentUserId={user.id}
      canManage={canManage}
      canInvite={canInvite}
      openInvite={invite === "1" && canInvite}
    />
  );
}
