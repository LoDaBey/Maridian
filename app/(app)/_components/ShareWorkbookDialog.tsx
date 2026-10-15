"use client";

import { useEffect, useState } from "react";
import {
  getWorkbookShareState,
  shareWorkbook,
  unshareWorkbook,
} from "@/app/(app)/sheets/actions";
import type { DirectoryUser, WorkbookMember } from "@/lib/db-types";
import { ROLE_LABEL } from "@/lib/rbac";

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
  const [users, setUsers] = useState<DirectoryUser[]>([]);
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
      const result = await shareWorkbook({ workbookId, userIds: [userId] });
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
            ? "People you share with can open this sheet."
            : "You can see who has access. Ask an owner or team leader to share."}
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
                        {member.isOwner ? "Owner" : ROLE_LABEL[member.role]}
                      </span>
                    </span>
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
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                    Add people
                  </p>
                  {candidates.length === 0 ? (
                    <p className="px-1 py-2 text-muted">
                      {needle ? "No people match." : "Everyone available is already shared."}
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
