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
      if (accept && result.href) {
        router.push(result.href);
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
                {invitation.role === "admin" ? "an admin" : "a member"}
                {invitation.workbookName ? (
                  <>
                    {" "}
                    and to the sheet <span dir="auto" className="font-medium text-text">{invitation.workbookName}</span>
                  </>
                ) : null}{" "}
                ·{" "}
                {new Date(invitation.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </p>
              {invitation.message ? (
                <p dir="auto" className="mt-2 whitespace-pre-wrap rounded-md border-s-2 border-primary bg-bg px-3 py-1.5 text-text">
                  {invitation.message}
                </p>
              ) : null}
              <p className={`mt-1 text-xs ${invitation.expired ? "text-danger" : "text-muted"}`}>
                {invitation.expired
                  ? "Expired. Ask the person who invited you to resend it."
                  : `Expires ${new Date(invitation.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
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
                disabled={busyId !== null || invitation.expired}
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
