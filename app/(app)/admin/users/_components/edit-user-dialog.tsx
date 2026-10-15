"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { updateUser, type UserActionState } from "@/app/(app)/admin/users/actions";
import { PRESENCE_COLORS } from "@/lib/colors";
import { ROLE_LABEL, ROLES } from "@/lib/rbac";
import type { AdminUser } from "@/lib/users";

const initialState: UserActionState = { error: "", credentials: null };

export function EditUserDialog({
  user,
  actorId,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  actorId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateUser, initialState);
  const [color, setColor] = useState(user.avatarColor);
  const isSelf = user.id === actorId;
  const seenState = useRef(state);

  useEffect(() => {
    if (seenState.current === state) {
      return;
    }
    seenState.current = state;
    if (!state.error) {
      onSaved();
    }
  }, [state, onSaved]);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-labelledby="edit-user-title"
        className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-sm"
      >
        <h2 id="edit-user-title" className="text-lg font-semibold">
          Edit {user.fullName}
        </h2>
        <p className="mt-1 text-sm text-muted">{user.email}</p>
        <form action={formAction} className="mt-4 flex flex-col gap-4">
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="avatarColor" value={color} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-full-name" className="text-sm font-medium">
              Full name
            </label>
            <input
              id="edit-full-name"
              name="fullName"
              required
              defaultValue={user.fullName}
              autoFocus
              className="rounded-lg border border-border px-3 py-2 outline-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-role" className="text-sm font-medium">
              Role
            </label>
            {isSelf ? <input type="hidden" name="role" value={user.role} /> : null}
            <select
              id="edit-role"
              name={isSelf ? undefined : "role"}
              defaultValue={user.role}
              disabled={isSelf}
              className="rounded-lg border border-border px-3 py-2 outline-none disabled:opacity-60"
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
            {isSelf ? (
              <p className="text-sm text-muted">You can&apos;t change your own role.</p>
            ) : null}
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Avatar colour</legend>
            <div className="flex flex-wrap gap-2">
              {PRESENCE_COLORS.map((swatch) => {
                const selected = swatch.toLowerCase() === color.toLowerCase();
                return (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`Select color ${swatch}`}
                    aria-pressed={selected}
                    className={`h-8 w-8 cursor-pointer rounded-lg border ${selected ? "border-text" : "border-transparent"}`}
                    style={{ backgroundColor: swatch }}
                    onClick={() => setColor(swatch)}
                  />
                );
              })}
            </div>
          </fieldset>
          {state.error ? (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              aria-label="Cancel editing user"
              className="cursor-pointer rounded-lg border border-border px-3 py-2 text-sm"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              aria-label={`Save changes for ${user.fullName}`}
              disabled={pending}
              className="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
