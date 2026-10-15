"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  resetUserPassword,
  setUserActive,
  type Credentials,
} from "@/app/(app)/admin/users/actions";
import type { AdminUser } from "@/lib/users";
import { CredentialsPanel } from "./credentials-panel";
import { EditUserDialog } from "./edit-user-dialog";
import { UserSearch } from "./user-search";
import { UsersTable } from "./users-table";

export function UsersAdmin({
  users,
  actorId,
}: {
  users: AdminUser[];
  actorId: string;
}) {
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const query = search.trim().toLowerCase();
  const visibleUsers = query
    ? users.filter((user) => {
        return (
          user.fullName.toLowerCase().includes(query) ||
          user.email.toLowerCase().includes(query)
        );
      })
    : users;

  const onSaved = useCallback(() => {
    setEditing(null);
    setError("");
  }, []);

  async function runRowAction(
    user: AdminUser,
    action: () => Promise<{ error: string; credentials: Credentials | null }>,
  ) {
    setPendingUserId(user.id);
    setError("");
    try {
      const result = await action();
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.credentials) {
        setCredentials(result.credentials);
      }
    } finally {
      setPendingUserId(null);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="mt-1 text-sm text-muted">
            Create accounts, change roles, and turn access on or off.
          </p>
        </div>
        <Link
          href="/admin/users/new"
          aria-label="New user"
          className="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white outline-none"
        >
          New user
        </Link>
      </div>
      {credentials ? (
        <CredentialsPanel credentials={credentials} onDismiss={() => setCredentials(null)} />
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <UserSearch value={search} onChange={setSearch} />
      <UsersTable
        users={visibleUsers}
        actorId={actorId}
        pendingUserId={pendingUserId}
        onEdit={setEditing}
        onResetPassword={(user) => {
          void runRowAction(user, () => resetUserPassword(user.id));
        }}
        onSetActive={(user, isActive) => {
          void runRowAction(user, () => setUserActive(user.id, isActive));
        }}
      />
      {editing ? (
        <EditUserDialog
          user={editing}
          actorId={actorId}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      ) : null}
    </main>
  );
}
