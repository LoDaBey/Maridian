"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { respondToInvitationAction } from "@/app/(app)/workspaces/actions";
import type { MyInvitation } from "@/lib/workspaces/repo";
import { WorkspaceBadge } from "./WorkspaceBadge";

export function InvitationList({ invitations }: { invitations: MyInvitation[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function respond(invitation: MyInvitation, accept: boolean) {
    setBusyId(invitation.id);
    setError("");
    try {
      const result = await respondToInvitationAction({ invitationId: invitation.id, accept });
      if (result.error) {
        setError(result.error);
        router.refresh();
        return;
      }
      if (accept && result.id) {
        router.push(`/w/${result.id}`);
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (invitations.length === 0) {
    return <p className="text-sm text-muted">No pending invitations.</p>;
  }

  return (
    <div>
      {error ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ul className="space-y-3">
        {invitations.map((invitation) => (
          <li
            key={invitation.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4"
          >
            <WorkspaceBadge name={invitation.workspaceName} color={invitation.workspaceColor} />
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium">{invitation.workspaceName}</p>
              <p className="text-muted">
                {invitation.invitedByName ?? "Someone"} invited you as{" "}
                {invitation.role === "admin" ? "an admin" : "a member"} ·{" "}
                {new Date(invitation.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                aria-label={`Decline invitation to ${invitation.workspaceName}`}
                disabled={busyId !== null}
                className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg disabled:opacity-60"
                onClick={() => void respond(invitation, false)}
              >
                Decline
              </button>
              <button
                type="button"
                aria-label={`Accept invitation to ${invitation.workspaceName}`}
                disabled={busyId !== null}
                className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                onClick={() => void respond(invitation, true)}
              >
                {busyId === invitation.id ? "Joining…" : "Accept"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
