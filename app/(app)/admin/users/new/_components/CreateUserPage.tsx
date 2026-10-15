"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { CredentialsPanel } from "@/app/(app)/admin/users/_components/credentials-panel";
import type { Credentials } from "@/app/(app)/admin/users/actions";
import { CreateUserForm } from "./CreateUserForm";

export function CreateUserPage({ suggestedPassword }: { suggestedPassword: string }) {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [formKey, setFormKey] = useState(0);

  const onCreated = useCallback((next: Credentials) => {
    setCredentials(next);
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            <Link href="/admin/users" className="cursor-pointer rounded-lg text-primary outline-none hover:underline">
              Users
            </Link>
            <span aria-hidden="true"> / </span>
            New user
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text">Create user</h1>
          <p className="mt-1 text-sm text-muted">
            Add someone to Meridian and assign their position.
          </p>
        </div>
        <Link
          href="/admin/users"
          aria-label="Back to users"
          className="cursor-pointer rounded-lg border border-border px-3 py-2 text-sm outline-none hover:bg-row"
        >
          All users
        </Link>
      </div>
      {credentials ? (
        <div className="mt-8">
          <CredentialsPanel
            credentials={credentials}
            onDismiss={() => {
              setCredentials(null);
              setFormKey((key) => key + 1);
            }}
          />
        </div>
      ) : (
        <div className="mt-8 rounded-xl border border-border bg-surface p-6">
          <CreateUserForm key={formKey} suggestedPassword={suggestedPassword} onCreated={onCreated} />
        </div>
      )}
    </main>
  );
}
