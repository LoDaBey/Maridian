"use client";

import { useState } from "react";
import type { Credentials } from "@/app/(app)/admin/users/actions";
import { APP_NAME } from "@/lib/brand";

function credentialsText(credentials: Credentials): string {
  return [
    `${APP_NAME} login`,
    `URL: ${credentials.url}`,
    `Email: ${credentials.email}`,
    `Temporary password: ${credentials.password}`,
  ].join("\n");
}

export function CredentialsPanel({
  credentials,
  onDismiss,
}: {
  credentials: Credentials;
  onDismiss: () => void;
}) {
  const [copyError, setCopyError] = useState("");
  const text = credentialsText(credentials);

  async function copyCredentials() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyError("");
    } catch {
      setCopyError("Couldn't copy. Select the text and copy it manually.");
    }
  }

  return (
    <section className="rounded-lg border border-primary bg-surface p-4" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Share these credentials once</h2>
          <p className="mt-1 text-sm text-muted">
            This password is shown only now. It is not stored in plain text.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Copy login credentials"
            className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white"
            onClick={() => {
              void copyCredentials();
            }}
          >
            Copy
          </button>
          <button
            type="button"
            aria-label="Dismiss credentials"
            className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-sm"
            onClick={onDismiss}
          >
            Done
          </button>
        </div>
      </div>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-bg p-3 text-sm">{text}</pre>
      {copyError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {copyError}
        </p>
      ) : null}
    </section>
  );
}
