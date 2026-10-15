"use client";

import { useState } from "react";
import type { FileAttachment } from "@/lib/db-types";
import { fileAttachmentFromLink } from "@/lib/files/link";

export function AddFileLink({
  disabled,
  addAriaLabel,
  onAdd,
}: {
  disabled?: boolean;
  addAriaLabel: string;
  onAdd: (file: FileAttachment) => void;
}) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  function submit(): void {
    const result = fileAttachmentFromLink(url, name);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onAdd(result.file);
    setUrl("");
    setName("");
    setError("");
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        value={url}
        disabled={disabled}
        aria-label="File link"
        placeholder="https://"
        className="rounded border border-border px-2 py-1 text-[13px] outline-none"
        onChange={(event) => setUrl(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      />
      <input
        value={name}
        disabled={disabled}
        aria-label="File name"
        placeholder="Name (optional)"
        className="rounded border border-border px-2 py-1 text-[13px] outline-none"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="button"
        aria-label={addAriaLabel}
        disabled={disabled || !url.trim()}
        className="cursor-pointer rounded-lg bg-primary px-2 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        onClick={submit}
      >
        Add file link
      </button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
