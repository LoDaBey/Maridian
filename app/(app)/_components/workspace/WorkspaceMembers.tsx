"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Search, UserPlus, X } from "lucide-react";
import {
  cancelInvitationAction,
  resendInvitationAction,
  changeMemberRoleAction,
  inviteMembersAction,
  removeMemberAction,
} from "@/app/(app)/workspaces/actions";
import type {
  WorkspaceInvitationView,
  WorkspaceMemberView,
  WorkspaceRole,
  WorkspaceSummary,
} from "@/lib/workspaces/repo";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { WorkspaceBadge } from "./WorkspaceBadge";

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const ROLE_HELP: Record<WorkspaceRole, string> = {
  owner: "Full control, including other owners",
  admin: "Invites people and manages members",
  member: "Creates sheets and opens sheets shared with them",
};

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white"
      style={{ backgroundColor: color }}
    >
      {(name[0] ?? "?").toUpperCase()}
    </span>
  );
}

export function WorkspaceMembers({
  workspace,
  members,
  invitations,
  invitable,
  currentUserId,
  canManage,
  canInvite,
  openInvite,
}: {
  workspace: WorkspaceSummary;
  members: WorkspaceMemberView[];
  invitations: WorkspaceInvitationView[];
  invitable: Array<{ id: string; fullName: string; email: string; avatarColor: string }>;
  currentUserId: string;
  canManage: boolean;
  /** Owners/admins, plus Project Managers who are members. */
  canInvite: boolean;
  openInvite: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"members" | "pending">("members");
  const [inviteOpen, setInviteOpen] = useState(openInvite);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [pasted, setPasted] = useState("");
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState<WorkspaceMemberView | null>(null);
  const isOwner = workspace.role === "owner";

  const needle = search.trim().toLowerCase();
  const candidates = useMemo(
    () =>
      invitable.filter(
        (user) =>
          !needle || user.fullName.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle),
      ),
    [invitable, needle],
  );
  const memberNeedle = memberSearch.trim().toLowerCase();
  const shownMembers = memberNeedle
    ? members.filter(
        (member) =>
          member.fullName.toLowerCase().includes(memberNeedle) || member.email.toLowerCase().includes(memberNeedle),
      )
    : members;

  async function run(task: () => Promise<{ error: string }>, success = ""): Promise<boolean> {
    if (pending) {
      return false;
    }
    setPending(true);
    setError("");
    setNotice("");
    try {
      const result = await task();
      if (result.error) {
        setError(result.error);
        return false;
      }
      if (success) {
        setNotice(success);
      }
      router.refresh();
      return true;
    } finally {
      setPending(false);
    }
  }

  async function sendInvites() {
    const ids = [...selected];
    const ok = await run(
      () => inviteMembersAction({ workspaceId: workspace.id, userIds: ids, role: inviteRole, message: note }),
      `Invitation${ids.length === 1 ? "" : "s"} sent. People join once they accept.`,
    );
    if (ok) {
      setSelected(new Set());
      setSearch("");
      setNote("");
      setPasted("");
      setUnmatched([]);
      setInviteOpen(false);
      setTab("pending");
    }
  }

  /** Selects everyone whose email is in the pasted text (commas, spaces or new lines). */
  function selectPasted() {
    const emails = [...new Set((pasted.toLowerCase().match(/[^\s,;<>"']+@[^\s,;<>"']+/g) ?? []).map((email) => email.trim()))];
    const byEmail = new Map(invitable.map((user) => [user.email.toLowerCase(), user.id]));
    setSelected((current) => {
      const next = new Set(current);
      for (const email of emails) {
        const id = byEmail.get(email);
        if (id) {
          next.add(id);
        }
      }
      return next;
    });
    setUnmatched(emails.filter((email) => !byEmail.has(email)));
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const leaving = removing?.userId === currentUserId;

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <Link
        href={`/w/${workspace.id}`}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to {workspace.name}
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <WorkspaceBadge name={workspace.name} color={workspace.color} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
          <p className="text-sm text-muted">
            People in {workspace.name}. Only members can be added to its sheets.
          </p>
        </div>
        {canInvite ? (
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white"
            onClick={() => setInviteOpen((open) => !open)}
          >
            <UserPlus className="size-4" aria-hidden="true" />
            Invite people
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-4 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          {notice}
        </p>
      ) : null}

      {inviteOpen && canInvite ? (
        <section aria-label="Invite people" className="mt-5 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border px-2 py-1.5">
              <Search className="size-4 text-muted" aria-hidden="true" />
              <input
                autoFocus
                value={search}
                placeholder="Search people by name or email"
                aria-label="Search people to invite"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <select
              aria-label="Role for invited people"
              value={inviteRole}
              className="cursor-pointer rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
              onChange={(event) => setInviteRole(event.target.value as "admin" | "member")}
            >
              <option value="member">Invite as Member</option>
              {canManage ? <option value="admin">Invite as Admin</option> : null}
            </select>
            <button
              type="button"
              disabled={pending || selected.size === 0}
              className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
              onClick={() => void sendInvites()}
            >
              {selected.size > 0 ? `Send ${selected.size} invite${selected.size === 1 ? "" : "s"}` : "Send invites"}
            </button>
          </div>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted hover:text-text">Paste a list of emails</summary>
            <div className="mt-2 flex flex-wrap items-start gap-2">
              <textarea
                value={pasted}
                rows={3}
                placeholder="sara@company.com, omar@company.com"
                aria-label="Emails to invite"
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
                onChange={(event) => setPasted(event.target.value)}
              />
              <button
                type="button"
                className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg"
                onClick={selectPasted}
              >
                Select them
              </button>
            </div>
            {unmatched.length > 0 ? (
              <p className="mt-1 text-xs text-muted">
                Not found or already in the workspace: {unmatched.join(", ")}. An admin can create accounts in Users.
              </p>
            ) : null}
          </details>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">Personal note (optional)</span>
            <textarea
              value={note}
              rows={2}
              maxLength={500}
              dir="auto"
              placeholder="Why you're inviting them, what to look at first…"
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <ul className="mt-3 max-h-64 space-y-0.5 overflow-auto">
            {candidates.map((user) => (
              <li key={user.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-bg">
                  <input
                    type="checkbox"
                    checked={selected.has(user.id)}
                    aria-label={`Invite ${user.fullName}`}
                    className="size-4 accent-primary"
                    onChange={() => toggle(user.id)}
                  />
                  <Avatar name={user.fullName} color={user.avatarColor} />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block truncate">{user.fullName}</span>
                    <span className="block truncate text-xs text-muted">{user.email}</span>
                  </span>
                </label>
              </li>
            ))}
            {candidates.length === 0 ? (
              <li className="px-2 py-2 text-sm text-muted">
                {needle ? "No people match." : "Everyone with an account is already a member or invited."}
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <div role="tablist" aria-label="Members" className="mt-6 flex gap-4 border-b border-border text-sm">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "members"}
          className={`-mb-px cursor-pointer border-b-2 px-1 pb-2 ${
            tab === "members" ? "border-primary font-medium text-primary" : "border-transparent text-muted"
          }`}
          onClick={() => setTab("members")}
        >
          Members ({members.length})
        </button>
        {canManage ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "pending"}
            className={`-mb-px cursor-pointer border-b-2 px-1 pb-2 ${
              tab === "pending" ? "border-primary font-medium text-primary" : "border-transparent text-muted"
            }`}
            onClick={() => setTab("pending")}
          >
            Pending invitations ({invitations.length})
          </button>
        ) : null}
      </div>

      {tab === "members" ? (
        <>
          {members.length > 8 ? (
            <label className="mt-4 flex max-w-xs items-center gap-2 rounded-md border border-border px-2 py-1.5">
              <Search className="size-4 text-muted" aria-hidden="true" />
              <input
                value={memberSearch}
                placeholder="Find a member"
                aria-label="Find a member"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                onChange={(event) => setMemberSearch(event.target.value)}
              />
            </label>
          ) : null}
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
            {shownMembers.map((member) => {
              const self = member.userId === currentUserId;
              // Admins can manage members and admins; only owners touch owners.
              const editable = canManage && !self && (isOwner || member.role !== "owner");
              return (
                <li key={member.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Avatar name={member.fullName} color={member.avatarColor} />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block truncate font-medium">
                      {member.fullName}
                      {self ? <span className="font-normal text-muted"> (you)</span> : null}
                    </span>
                    <span className="block truncate text-xs text-muted">{member.email}</span>
                  </span>
                  {editable ? (
                    <select
                      aria-label={`Role for ${member.fullName}`}
                      value={member.role}
                      disabled={pending}
                      title={ROLE_HELP[member.role]}
                      className="cursor-pointer rounded-md border border-border bg-surface px-2 py-1 text-sm"
                      onChange={(event) =>
                        void run(() =>
                          changeMemberRoleAction({
                            workspaceId: workspace.id,
                            userId: member.userId,
                            role: event.target.value as WorkspaceRole,
                          }),
                        )
                      }
                    >
                      {isOwner ? <option value="owner">Owner</option> : null}
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                  ) : (
                    <span className="rounded-full bg-bg px-2 py-0.5 text-xs text-muted" title={ROLE_HELP[member.role]}>
                      {ROLE_LABEL[member.role]}
                    </span>
                  )}
                  {editable || self ? (
                    <button
                      type="button"
                      disabled={pending}
                      className="cursor-pointer rounded-md px-2 py-1 text-sm text-danger hover:bg-danger/10 disabled:opacity-60"
                      onClick={() => setRemoving(member)}
                    >
                      {self ? "Leave" : "Remove"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Avatar name={invitation.fullName} color={invitation.avatarColor} />
              <span className="min-w-0 flex-1 text-sm">
                <span className="block truncate font-medium">{invitation.fullName}</span>
                <span className="block truncate text-xs text-muted">
                  {invitation.email} · invited as {ROLE_LABEL[invitation.role]}
                  {invitation.invitedByName ? ` by ${invitation.invitedByName}` : ""}
                  {invitation.workbookName ? ` · with sheet ${invitation.workbookName}` : ""}
                </span>
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${invitation.expired ? "bg-danger/10 text-danger" : "bg-bg text-muted"}`}
                title={`Expires ${new Date(invitation.expiresAt).toLocaleString()}`}
              >
                {invitation.expired
                  ? "Expired"
                  : `Expires ${new Date(invitation.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
              </span>
              <button
                type="button"
                aria-label={`Resend invitation to ${invitation.fullName}`}
                disabled={pending}
                className="cursor-pointer rounded-md px-2 py-1 text-sm text-primary hover:bg-primary/10 disabled:opacity-60"
                onClick={() => void run(() => resendInvitationAction({ invitationId: invitation.id }), "Invitation sent again.")}
              >
                Resend
              </button>
              <button
                type="button"
                aria-label={`Cancel invitation for ${invitation.fullName}`}
                disabled={pending}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-sm text-muted hover:bg-bg hover:text-text disabled:opacity-60"
                onClick={() =>
                  void run(() => cancelInvitationAction({ invitationId: invitation.id }), "Invitation cancelled.")
                }
              >
                <X className="size-4" aria-hidden="true" />
                Cancel
              </button>
            </li>
          ))}
          {invitations.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted">No pending invitations.</li>
          ) : null}
        </ul>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={leaving ? `Leave ${workspace.name}?` : `Remove ${removing?.fullName ?? ""}?`}
        message={
          leaving
            ? "You'll lose access to every sheet in this workspace until someone invites you again."
            : "They'll lose access to every sheet in this workspace right away, including any sheet they have open."
        }
        confirmLabel={leaving ? "Leave workspace" : "Remove"}
        danger
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (!target) {
            return;
          }
          void run(() => removeMemberAction({ workspaceId: workspace.id, userId: target.userId })).then((ok) => {
            if (ok && target.userId === currentUserId) {
              router.push("/");
            }
          });
        }}
      />
    </main>
  );
}
