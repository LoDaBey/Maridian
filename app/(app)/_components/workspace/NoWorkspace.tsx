"use client";

import { useState } from "react";
import { LayoutGrid } from "lucide-react";
import type { MyInvitation } from "@/lib/workspaces/repo";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { InvitationList } from "./InvitationList";

export function NoWorkspace({
  invitations,
  canCreate,
}: {
  invitations: MyInvitation[];
  canCreate: boolean;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-center px-6 py-16 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <LayoutGrid className="size-6" aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">You&apos;re not in a workspace yet</h1>
      <p className="mt-2 text-sm text-muted">
        {invitations.length > 0
          ? "Accept an invitation below to see the sheets shared with you."
          : canCreate
            ? "Create a workspace for your team, then invite people to it."
            : "Ask a workspace owner or admin to invite you. Invitations will show up here."}
      </p>
      {invitations.length > 0 ? (
        <div className="mt-6 w-full text-start">
          <InvitationList invitations={invitations} />
        </div>
      ) : null}
      {canCreate ? (
        <button
          type="button"
          className="mt-6 cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
          onClick={() => setCreating(true)}
        >
          Create workspace
        </button>
      ) : null}
      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </main>
  );
}
