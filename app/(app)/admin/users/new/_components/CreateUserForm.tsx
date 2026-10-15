"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createUser,
  regeneratePassword,
  type Credentials,
  type UserActionState,
} from "@/app/(app)/admin/users/actions";
import { ROLE_LABEL, ROLES } from "@/lib/rbac";

const initialState: UserActionState = { error: "", credentials: null };

export function CreateUserForm({
  suggestedPassword,
  onCreated,
}: {
  suggestedPassword: string;
  onCreated: (credentials: Credentials) => void;
}) {
  const [state, formAction, pending] = useActionState(createUser, initialState);
  const [password, setPassword] = useState(suggestedPassword);
  const [showPassword, setShowPassword] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const seenState = useRef(state);

  useEffect(() => {
    if (seenState.current === state) {
      return;
    }
    seenState.current = state;
    if (state.credentials) {
      onCreated(state.credentials);
    }
  }, [state, onCreated]);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="fullName" className="text-sm font-medium">
          Full name
        </label>
        <input
          id="fullName"
          name="fullName"
          required
          autoFocus
          className="rounded-lg border border-border px-3 py-2 outline-none"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="off"
          spellCheck={false}
          className="rounded-lg border border-border px-3 py-2 outline-none"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="role" className="text-sm font-medium">
          Position
        </label>
        <select
          id="role"
          name="role"
          defaultValue="employee"
          className="rounded-lg border border-border px-3 py-2 outline-none"
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABEL[role]}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted">Sets what this person can do in Meridian.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Temporary password
        </label>
        <div className="flex gap-2">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            value={password}
            spellCheck={false}
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 outline-none"
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="cursor-pointer rounded-lg border border-border px-3 py-2 text-sm outline-none"
            onClick={() => setShowPassword((current) => !current)}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <button
          type="button"
          aria-label="Regenerate password"
          className="cursor-pointer self-start rounded-lg border border-border px-3 py-1.5 text-sm outline-none"
          disabled={regenerating}
          onClick={() => {
            setRegenerating(true);
            void regeneratePassword()
              .then((next) => {
                setPassword(next);
                setShowPassword(true);
              })
              .finally(() => setRegenerating(false));
          }}
        >
          {regenerating ? "Regenerating..." : "Regenerate"}
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          name="requirePasswordChange"
          type="checkbox"
          defaultChecked
          className="rounded outline-none"
        />
        Require password change on first login
      </label>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          aria-label="Create user"
          disabled={pending}
          className="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Creating..." : "Create user"}
        </button>
      </div>
    </form>
  );
}
