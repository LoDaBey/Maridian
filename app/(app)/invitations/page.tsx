import { requireUser } from "@/lib/auth/current-user";
import { listMyInvitations } from "@/lib/workspaces/repo";
import { InvitationList } from "../_components/workspace/InvitationList";

export const instant = false;

export default async function InvitationsPage() {
  const user = await requireUser();
  const invitations = await listMyInvitations(user.id);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Invitations</h1>
      <p className="mt-1 text-sm text-muted">
        Join a workspace to see the sheets its members share with you.
      </p>
      <div className="mt-6">
        <InvitationList invitations={invitations} />
      </div>
    </main>
  );
}
