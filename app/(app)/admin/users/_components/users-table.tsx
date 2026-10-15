"use client";

import { ROLE_LABEL } from "@/lib/rbac";
import type { AdminUser } from "@/lib/users";
import { UserAvatar } from "./user-avatar";

function formatCreated(iso: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(iso));
}

function formatLastLogin(iso: string | null): string {
  if (!iso) {
    return "Never";
  }

  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absolute < 60) {
    return format.format(seconds, "second");
  }
  if (absolute < 3600) {
    return format.format(Math.round(seconds / 60), "minute");
  }
  if (absolute < 86400) {
    return format.format(Math.round(seconds / 3600), "hour");
  }
  if (absolute < 86400 * 30) {
    return format.format(Math.round(seconds / 86400), "day");
  }

  return formatCreated(iso);
}

export function UsersTable({
  users,
  actorId,
  pendingUserId,
  onEdit,
  onResetPassword,
  onSetActive,
}: {
  users: AdminUser[];
  actorId: string;
  pendingUserId: string | null;
  onEdit: (user: AdminUser) => void;
  onResetPassword: (user: AdminUser) => void;
  onSetActive: (user: AdminUser, isActive: boolean) => void;
}) {
  if (users.length === 0) {
    return <p className="text-sm text-muted">No users match your search.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <thead className="border-b border-border text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Last login</th>
            <th className="px-3 py-2 font-medium">Created</th>
            <th className="px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const pending = pendingUserId === user.id;
            const isSelf = user.id === actorId;
            return (
              <tr key={user.id} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <UserAvatar fullName={user.fullName} color={user.avatarColor} />
                    <span className="font-medium">{user.fullName}</span>
                  </span>
                </td>
                <td className="px-3 py-2">{user.email}</td>
                <td className="px-3 py-2">
                  <span className="rounded-lg bg-bg px-2 py-0.5 text-xs">
                    {ROLE_LABEL[user.role]}
                  </span>
                </td>
                <td className={`px-3 py-2 ${user.isActive ? "text-success" : "text-muted"}`}>
                  {user.isActive ? "Active" : "Inactive"}
                </td>
                <td className="px-3 py-2">{formatLastLogin(user.lastLoginAt)}</td>
                <td className="px-3 py-2">{formatCreated(user.createdAt)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-label={`Edit ${user.fullName}`}
                      className="cursor-pointer rounded-lg border border-border px-2.5 py-1 text-xs"
                      onClick={() => onEdit(user)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Reset password for ${user.fullName}`}
                      disabled={pending}
                      className="cursor-pointer rounded-lg border border-border px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => onResetPassword(user)}
                    >
                      Reset password
                    </button>
                    {user.isActive ? (
                      <button
                        type="button"
                        aria-label={
                          isSelf
                            ? "You can't deactivate your own account"
                            : `Deactivate ${user.fullName}`
                        }
                        disabled={pending || isSelf}
                        className="cursor-pointer rounded-lg border border-border px-2.5 py-1 text-xs text-danger disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => onSetActive(user, false)}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Reactivate ${user.fullName}`}
                        disabled={pending}
                        className="cursor-pointer rounded-lg border border-border px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => onSetActive(user, true)}
                      >
                        Reactivate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
