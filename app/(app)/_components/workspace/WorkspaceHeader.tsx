"use client";

import { useState } from "react";
import Link from "next/link";
import { Settings, UserPlus } from "lucide-react";
import type { WorkspaceMemberView, WorkspaceSummary } from "@/lib/workspaces/repo";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { WorkspaceBadge } from "./WorkspaceBadge";

export function WorkspaceHeader({
  workspace,
  members,
  canManage,
}: {
  workspace: WorkspaceSummary;
  members: WorkspaceMemberView[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const extra = workspace.memberCount - members.length;

  return (
    <section className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4 px-6 py-6">
        <WorkspaceBadge name={workspace.name} color={workspace.color} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{workspace.name}</h1>
          {workspace.description ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted">{workspace.description}</p>
          ) : null}
        </div>
        <Link
          href={`/w/${workspace.id}/members`}
          aria-label={`${workspace.memberCount} members`}
          className="flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {members.map((member) => (
            <span
              key={member.userId}
              title={member.fullName}
              className="-ms-2 inline-flex size-8 items-center justify-center rounded-full border-2 border-surface text-xs font-medium text-white first:ms-0"
              style={{ backgroundColor: member.avatarColor }}
            >
              {(member.fullName[0] ?? "?").toUpperCase()}
            </span>
          ))}
          {extra > 0 ? (
            <span className="-ms-2 inline-flex size-8 items-center justify-center rounded-full border-2 border-surface bg-bg text-xs text-muted">
              +{extra}
            </span>
          ) : null}
        </Link>
        {canManage ? (
          <div className="flex gap-2">
            <Link
              href={`/w/${workspace.id}/members?invite=1`}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white"
            >
              <UserPlus className="size-4" aria-hidden="true" />
              Invite
            </Link>
            <button
              type="button"
              aria-label="Workspace settings"
              className="cursor-pointer rounded-lg border border-border p-2 text-muted hover:bg-bg hover:text-text"
              onClick={() => setEditing(true)}
            >
              <Settings className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
      <CreateWorkspaceDialog
        open={editing}
        onClose={() => setEditing(false)}
        workspace={{
          id: workspace.id,
          name: workspace.name,
          description: workspace.description,
          color: workspace.color,
        }}
      />
    </section>
  );
}
