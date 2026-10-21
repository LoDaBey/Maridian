"use client";

import { useEffect, useState } from "react";
import {
  getWorkbookShareState,
  setWorkbookMemberAccess,
  shareWorkbook,
  unshareWorkbook,
  type ShareCandidate,
} from "@/app/(app)/sheets/actions";
import type { WorkbookMember } from "@/lib/db-types";

type Access = "editor" | "viewer";

const ACCESS_LABEL: Record<WorkbookMember["boardRole"], string> = {
  owner: "Owner",
  editor: "Can edit",
  viewer: "Can view",
};

export function ShareWorkbookDialog({
  open,
  workbookId,
  workbookName,
  onClose,
}: {
  open: boolean;
  workbookId: string;
  workbookName: string;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<WorkbookMember[]>([]);
  const [users, setUsers] = useState<ShareCandidate[]>([]);
  const [newAccess, setNewAccess] = useState<Access>("editor");
  const [workspaceName, setWorkspaceName] = useState("");
  const [canShare, setCanShare] = useState(false);
  const [title, setTitle] = useState(workbookName);

  useEffect(() => {
    if (!open) {
      setError("");
      setPending(false);
      setQuery("");
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, pending]);

  useEffect(() => {
    if (!open || !workbookId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void getWorkbookShareState({ workbookId }).then((state) => {
      if (cancelled) {
        return;
      }
      setLoading(false);
      if (state.error) {
        setError(state.error);
        return;
      }
      setMembers(state.members);
      setUsers(state.users);
      setCanShare(state.canShare);
      setTitle(state.workbookName || workbookName);
      setWorkspaceName(state.workspaceName);
    });
    return () => {
      cancelled = true;
    };
  }, [open, workbookId, workbookName]);

  if (!open) {
    return null;
  }

  const memberIds = new Set(members.map((member) => member.userId));
  const needle = query.trim().toLowerCase();
  const candidates = users.filter((user) => {
    if (memberIds.has(user.id)) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return (
      user.fullName.toLowerCase().includes(needle) ||
      user.email.toLowerCase().includes(needle)
    );
  });

  async function addUser(userId: string) {
    if (!canShare || pending) {
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await shareWorkbook({ workbookId, userIds: [userId], role: newAccess });
      if (result.error) {
        setError(result.error);
        return;
      }
      const state = await getWorkbookShareState({ workbookId });
      if (state.error) {
        setError(state.error);
        return;
      }
      setMembers(state.members);
      setUsers(state.users);
      setQuery("");
    } finally {
      setPending(false);
    }
  }

  async function changeAccess(userId: string, role: Access) {
    if (!canShare || pending) {
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await setWorkbookMemberAccess({ workbookId, userId, role });
      if (result.error) {
        setError(result.error);
        return;
      }
      setMembers((current) =>
        current.map((member) => (member.userId === userId ? { ...member, boardRole: role } : member)),
      );
    } finally {
      setPending(false);
    }
  }

  async function removeUser(userId: string) {
    if (!canShare || pending) {
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await unshareWorkbook({ workbookId, userId });
      if (result.error) {
        setError(result.error);
        return;
      }
      setMembers((current) => current.filter((member) => member.userId !== userId));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-labelledby="share-workbook-title"
        className="flex max-h-[min(36rem,90vh)] w-full max-w-md flex-col rounded-lg border border-border bg-surface p-5 text-sm shadow-xl"
      >
        <h2 id="share-workbook-title" className="text-base font-semibold">
          Share {title}
        </h2>
        <p className="mt-1 text-muted">
          {canShare
            ? `Share with members of ${workspaceName || "this workspace"}. Viewers can open the sheet but can't edit it.`
            : "You can see who has access. Ask the sheet owner or a workspace admin to share."}
        </p>
        {canShare ? (
          <input
            value={query}
            aria-label="Search people to share with"
            placeholder="Search people"
            className="mt-3 w-full rounded border border-border px-2 py-1.5 outline-none"
            onChange={(event) => setQuery(event.target.value)}
          />
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-3 min-h-0 flex-1 overflow-auto">
          {loading ? (
            <p className="px-1 py-2 text-muted">Loading…</p>
          ) : (
            <>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                People with access
              </p>
              <ul className="mb-3 space-y-1">
                {members.map((member) => (
                  <li
                    key={member.userId}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                  >
                    <span
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] text-white"
                      style={{ backgroundColor: member.avatarColor }}
                    >
                      {(member.fullName[0] ?? "?").toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{member.fullName}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {member.email}
                      </span>
                    </span>
                    {canShare && !member.isOwner ? (
                      <select
                        aria-label={`Access for ${member.fullName}`}
                        value={member.boardRole}
                        disabled={pending}
                        className="cursor-pointer rounded border border-border bg-surface px-1.5 py-1 text-xs outline-none"
                        onChange={(event) => void changeAccess(member.userId, event.target.value as Access)}
                      >
                        <option value="editor">Can edit</option>
                        <option value="viewer">Can view</option>
                      </select>
                    ) : (
                      <span className="text-xs text-muted">{ACCESS_LABEL[member.boardRole]}</span>
                    )}
                    {canShare && !member.isOwner ? (
                      <button
                        type="button"
                        aria-label={`Remove ${member.fullName}`}
                        disabled={pending}
                        className="cursor-pointer rounded-lg px-2 py-1 text-xs text-danger outline-none hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => void removeUser(member.userId)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {canShare ? (
                <>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">Add people</p>
                    <select
                      aria-label="Access for new people"
                      value={newAccess}
                      className="cursor-pointer rounded border border-border bg-surface px-1.5 py-1 text-xs outline-none"
                      onChange={(event) => setNewAccess(event.target.value as Access)}
                    >
                      <option value="editor">Can edit</option>
                      <option value="viewer">Can view</option>
                    </select>
                  </div>
                  {candidates.length === 0 ? (
                    <p className="px-1 py-2 text-muted">
                      {needle
                        ? "No people match."
                        : "Everyone in this workspace already has access. Invite more people to the workspace first."}
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {candidates.map((user) => (
                        <li key={user.id}>
                          <button
                            type="button"
                            aria-label={`Share with ${user.fullName}`}
                            disabled={pending}
                            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-start outline-none hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => void addUser(user.id)}
                          >
                            <span
                              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] text-white"
                              style={{ backgroundColor: user.avatarColor }}
                            >
                              {(user.fullName[0] ?? "?").toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{user.fullName}</span>
                              <span className="block truncate text-[11px] text-muted">
                                {user.email}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : null}
            </>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            aria-label="Close share sheet"
            disabled={pending}
            className="cursor-pointer rounded-lg px-3 py-1.5 outline-none disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
