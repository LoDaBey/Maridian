"use client";

import { useMemo, useState } from "react";
import { Paperclip } from "lucide-react";
import type { DirectoryUser } from "@/components/grid/types";
import type { FileAttachment } from "@/lib/db-types";
import { FILE_MAX_COUNT } from "@/lib/sheets/column-meta";
import { AddFileLink } from "@/components/files/AddFileLink";
import { FileLinkRow } from "@/components/files/FileLinkRow";
import { MentionInput } from "./MentionInput";

export function MentionComposer({
  users,
  placeholder,
  disabled,
  initialBody = "",
  initialMentions = [],
  submitLabel = "Post",
  submitAriaLabel = "Post update",
  onCancel,
  autoFocus,
  sheetId,
  onSubmit,
}: {
  users: DirectoryUser[];
  placeholder: string;
  disabled?: boolean;
  initialBody?: string;
  initialMentions?: string[];
  submitLabel?: string;
  submitAriaLabel?: string;
  onCancel?: () => void;
  autoFocus?: boolean;
  sheetId?: string;
  onSubmit: (body: string, mentions: string[], attachments?: FileAttachment[]) => Promise<string | null>;
}) {
  const [body, setBody] = useState(initialBody);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentions, setMentions] = useState<string[]>(initialMentions);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [addingLink, setAddingLink] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    if (mentionQuery === null) {
      return [];
    }
    const needle = mentionQuery.toLowerCase();
    return users
      .filter(
        (user) =>
          user.fullName.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle),
      )
      .slice(0, 6);
  }, [mentionQuery, users]);

  function onChange(value: string): void {
    setBody(value);
    const match = /(^|\s)@([^\s@]*)$/.exec(value);
    setMentionQuery(match ? match[2] ?? "" : null);
  }

  function pick(user: DirectoryUser): void {
    const replaced = body.replace(/(^|\s)@([^\s@]*)$/, `$1@${user.fullName} `);
    setBody(replaced);
    setMentions((current) => (current.includes(user.id) ? current : [...current, user.id]));
    setMentionQuery(null);
  }

  async function submit(): Promise<void> {
    const text = body.trim();
    if (!text) {
      return;
    }
    const result = await onSubmit(text, mentions, attachments);
    if (result) {
      setError(result);
      return;
    }
    setBody("");
    setMentions([]);
    setAttachments([]);
    setAddingLink(false);
    setError(null);
  }

  return (
    <div className="relative">
      <MentionInput
        body={body}
        users={users}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={onChange}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onCancel) {
            event.preventDefault();
            onCancel();
            return;
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {suggestions.length > 0 ? (
        <ul className="absolute bottom-full z-20 mb-1 w-full rounded-lg border border-border bg-surface shadow">
          {suggestions.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                aria-label={`Mention ${user.fullName}`}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-start text-sm hover:bg-gray-50"
                onClick={() => pick(user)}
              >
                <span
                  className="inline-flex size-5 items-center justify-center rounded-full text-[10px] text-white"
                  style={{ backgroundColor: user.avatarColor }}
                >
                  {user.fullName.slice(0, 1).toUpperCase()}
                </span>
                {user.fullName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {attachments.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {attachments.map((file) => (
            <FileLinkRow
              key={file.id}
              file={file}
              onRemove={() => setAttachments((current) => current.filter((item) => item.id !== file.id))}
            />
          ))}
        </ul>
      ) : null}
      {sheetId && addingLink && attachments.length < FILE_MAX_COUNT ? (
        <div className="mt-2">
          <AddFileLink
            disabled={disabled}
            addAriaLabel="Add file link to this update"
            onAdd={(file) => {
              setAttachments((current) => [...current, file]);
              setAddingLink(false);
            }}
          />
        </div>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted">{error ?? "Type @ to mention someone."}</p>
        <div className="flex items-center gap-2">
          {sheetId ? (
            <button
              type="button"
              aria-label={addingLink ? "Hide file link form" : "Attach a file link"}
              disabled={disabled || attachments.length >= FILE_MAX_COUNT}
              className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setAddingLink((open) => !open)}
            >
              <Paperclip className="size-4" aria-hidden="true" />
            </button>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              aria-label="Cancel edit"
              className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-gray-50"
              onClick={onCancel}
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            aria-label={submitAriaLabel}
            disabled={disabled || !body.trim()}
            className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void submit()}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
