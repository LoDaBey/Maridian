"use client";

import { useState } from "react";
import { ThumbsUp } from "lucide-react";
import type { DirectoryUser } from "@/components/grid/types";
import type { RowUpdateDto } from "@/lib/db-types";
import { FileLinkRow } from "@/components/files/FileLinkRow";
import { MentionComposer } from "./MentionComposer";
import { MentionText } from "./MentionText";

export function UpdateCard({
  update,
  meId,
  users,
  readOnly,
  onEdit,
  onRemove,
  onReply,
  onReact,
}: {
  update: RowUpdateDto;
  meId: string;
  users: DirectoryUser[];
  readOnly: boolean;
  onEdit: (id: string, body: string, mentions: string[]) => Promise<string | null>;
  onRemove: (id: string) => Promise<string | null>;
  onReply: (id: string, body: string, mentions: string[]) => Promise<string | null>;
  onReact: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const liked = update.reactions.some((reaction) => reaction.emoji === "👍" && reaction.userIds.includes(meId));
  const likeCount = update.reactions.find((reaction) => reaction.emoji === "👍")?.userIds.length ?? 0;
  const own = update.author.id === meId;

  return (
    <article className="rounded-lg border border-border p-3">
      <header className="flex items-center gap-2">
        <span
          className="inline-flex size-6 items-center justify-center rounded-full text-[10px] text-white"
          style={{ backgroundColor: update.author.avatarColor }}
        >
          {update.author.fullName.slice(0, 1).toUpperCase()}
        </span>
        <span className="font-medium">{update.author.fullName}</span>
        <span className="text-xs text-muted">{new Date(update.createdAt).toLocaleString()}</span>
      </header>
      {editing ? (
        <div className="mt-2">
          <MentionComposer
            key={update.id}
            users={users}
            placeholder="Edit update…"
            initialBody={update.body}
            initialMentions={update.mentions}
            submitLabel="Save"
            submitAriaLabel="Save update"
            autoFocus
            onCancel={() => setEditing(false)}
            onSubmit={async (body, mentions) => {
              const result = await onEdit(update.id, body, mentions);
              if (!result) {
                setEditing(false);
              }
              return result;
            }}
          />
        </div>
      ) : (
        <>
          <p className="mt-2 whitespace-pre-wrap text-sm">
            <MentionText body={update.body} users={users} />
          </p>
          {update.attachments.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {update.attachments.map((file) => (
                <FileLinkRow key={file.id} file={file} />
              ))}
            </ul>
          ) : null}
        </>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label={liked ? "Unlike update" : "Like update"}
          disabled={readOnly}
          className={`cursor-pointer rounded-lg px-2 py-1 text-xs ${liked ? "bg-primary/10 text-primary" : "text-muted hover:bg-gray-50"}`}
          onClick={() => void onReact(update.id)}
        >
          <ThumbsUp className="me-1 inline size-3.5" aria-hidden="true" />
          {likeCount || ""}
        </button>
        {own && !readOnly && !editing ? (
          <>
            <button
              type="button"
              aria-label="Edit update"
              className="cursor-pointer rounded-lg px-2 py-1 text-xs text-muted hover:bg-gray-50"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <button
              type="button"
              aria-label="Delete update"
              className="cursor-pointer rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-gray-50"
              onClick={() => void onRemove(update.id)}
            >
              Delete
            </button>
          </>
        ) : null}
      </div>
      {update.seenBy.length > 0 ? (
        <p className="mt-2 text-xs text-muted">Seen by {update.seenBy.map((user) => user.fullName).join(", ")}</p>
      ) : null}
      {update.replies.map((reply) => (
        <div key={reply.id} className="mt-3 ms-6 rounded-lg bg-gray-50 p-2 text-sm">
          <p className="font-medium">{reply.author.fullName}</p>
          <p className="whitespace-pre-wrap">
            <MentionText body={reply.body} users={users} />
          </p>
        </div>
      ))}
      {!readOnly && !editing ? (
        <div className="mt-3">
          <MentionComposer
            users={users}
            placeholder="Write a reply…"
            submitAriaLabel="Post reply"
            onSubmit={(body, mentions) => onReply(update.id, body, mentions)}
          />
        </div>
      ) : null}
    </article>
  );
}
