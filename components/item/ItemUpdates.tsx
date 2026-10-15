"use client";

import { useRowUpdates } from "@/app/(app)/s/[sheetId]/updates/use-row-updates";
import type { DirectoryUser } from "@/components/grid/types";
import { MentionComposer } from "./MentionComposer";
import { UpdateCard } from "./UpdateCard";

export function ItemUpdates({
  sheetId,
  rowId,
  meId,
  users,
  readOnly,
}: {
  sheetId: string;
  rowId: string;
  meId: string;
  users: DirectoryUser[];
  readOnly: boolean;
}) {
  const { updates, loading, error, post, edit, remove, reply, react } = useRowUpdates(sheetId, rowId);

  return (
    <div className="flex flex-col gap-4 p-4">
      {error ? <p className="text-sm text-muted">{error}</p> : null}
      {loading && updates.length === 0 ? <p className="text-sm text-muted">Loading updates…</p> : null}
      {updates.map((update) => (
        <UpdateCard
          key={update.id}
          update={update}
          meId={meId}
          users={users}
          readOnly={readOnly}
          onEdit={edit}
          onRemove={remove}
          onReply={reply}
          onReact={react}
        />
      ))}
      {updates.length === 0 && !loading ? <p className="text-sm text-muted">No updates yet.</p> : null}
      {!readOnly ? <MentionComposer users={users} placeholder="Write an update…" sheetId={sheetId} onSubmit={post} /> : null}
    </div>
  );
}
