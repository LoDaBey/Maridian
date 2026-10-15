"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { login, type LoginState } from "@/app/(auth)/login/actions";
import { AppLogo } from "@/components/brand/AppLogo";

const initialState: LoginState = { error: "" };

export function LoginPanel() {
  const [state, formAction, pending] = useActionState(login, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="w-full max-w-md rounded-lg border border-border bg-surface px-8 py-10 shadow-sm">
      <AppLogo size="lg" />
      <h1 className="mt-8 text-[1.75rem] font-semibold tracking-tight text-text">
        Welcome back
      </h1>
      <p className="mt-1.5 text-sm text-muted">Sign in to continue.</p>
      <form action={formAction} className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="rounded-lg border border-border px-3 py-2.5 outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              className="w-full rounded-lg border border-border px-3 py-2.5 pe-11 outline-none focus:border-primary"
            />
            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute end-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-lg p-1.5 text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
              onClick={() => setShowPassword((current) => !current)}
            >
              {showPassword ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          aria-label="Sign in"
          className="mt-1 cursor-pointer rounded-lg bg-primary px-4 py-2.5 font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
