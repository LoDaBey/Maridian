"use client";

import { useActionState } from "react";
import {
  changePassword,
  type ChangePasswordState,
} from "@/app/(auth)/change-password/actions";
import { AppLogo } from "@/components/brand/AppLogo";

const initialState: ChangePasswordState = { error: "" };

export default function ChangePasswordPage() {
  const [state, formAction, pending] = useActionState(
    changePassword,
    initialState,
  );

  return (
    <main className="w-full max-w-md rounded-lg border border-border bg-surface p-8 shadow-sm">
      <AppLogo size="lg" />
      <h1 className="mt-8 text-2xl font-semibold">Change password</h1>
      <form action={formAction} className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="currentPassword" className="text-sm font-medium">
            Current password
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            className="rounded-lg border border-border px-3 py-2 outline-none"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="newPassword" className="text-sm font-medium">
            New password
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            className="rounded-lg border border-border px-3 py-2 outline-none"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirmPassword" className="text-sm font-medium">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            className="rounded-lg border border-border px-3 py-2 outline-none"
          />
        </div>
        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          aria-label="Save new password"
          className="cursor-pointer rounded-lg bg-primary px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save password"}
        </button>
      </form>
    </main>
  );
}
