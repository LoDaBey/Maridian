"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { addCellComment, listCellComments, resolveCellComments, type CellComment } from "@/app/(app)/sheets/comment-actions";
import { getSocket } from "@/lib/realtime/client";

interface Thread {
  rowId: string;
  columnId: string;
  x: number;
  y: number;
}

interface CommentsState {
  byCell: ReadonlyMap<string, CellComment[]>;
  open: (thread: Thread) => void;
}

const Context = createContext<CommentsState>({ byCell: new Map(), open: () => {} });
const key = (rowId: string, columnId: string) => `${rowId}:${columnId}`;

/** Loads the tab's open cell comments and keeps them live; renders the thread popover. */
export function CellCommentsProvider({ sheetId, canResolve, children }: { sheetId: string; canResolve: boolean; children: ReactNode }) {
  const [comments, setComments] = useState<CellComment[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);

  const refresh = useCallback(() => {
    void listCellComments(sheetId).then(setComments);
  }, [sheetId]);

  useEffect(() => {
    const socket = getSocket();
    const onChanged = (payload: { sheetId?: string }) => {
      if (payload?.sheetId === sheetId) {
        refresh();
      }
    };
    refresh();
    socket.on("cell-comments:changed", onChanged);
    socket.on("connect", refresh);
    return () => {
      socket.off("cell-comments:changed", onChanged);
      socket.off("connect", refresh);
    };
  }, [sheetId, refresh]);

  const byCell = useMemo(() => {
    const map = new Map<string, CellComment[]>();
    for (const comment of comments) {
      const list = map.get(key(comment.rowId, comment.columnId)) ?? [];
      list.push(comment);
      map.set(key(comment.rowId, comment.columnId), list);
    }
    return map;
  }, [comments]);

  const value = useMemo<CommentsState>(() => ({ byCell, open: setThread }), [byCell]);

  return (
    <Context.Provider value={value}>
      {children}
      {thread ? (
        <ThreadPopover
          sheetId={sheetId}
          thread={thread}
          comments={byCell.get(key(thread.rowId, thread.columnId)) ?? []}
          canResolve={canResolve}
          onChanged={refresh}
          onClose={() => setThread(null)}
        />
      ) : null}
    </Context.Provider>
  );
}

export function useCellComments() {
  return useContext(Context);
}

/** Small corner marker on a commented cell; clicking it opens the thread. */
export function CommentMarker({ rowId, columnId }: { rowId: string; columnId: string }) {
  const { byCell, open } = useCellComments();
  const list = byCell.get(key(rowId, columnId));
  if (!list || list.length === 0) {
    return null;
  }
  return (
    <button
      type="button"
      aria-label={`${list.length} comment${list.length === 1 ? "" : "s"} on this cell`}
      title={`${list[list.length - 1]!.authorName}: ${list[list.length - 1]!.body}`}
      className="absolute end-0 top-0 z-[6] size-0 cursor-pointer border-s-[9px] border-t-[9px] border-s-transparent border-t-[#fdab3d]"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        open({ rowId, columnId, x: event.clientX, y: event.clientY });
      }}
    />
  );
}

function ThreadPopover({
  sheetId,
  thread,
  comments,
  canResolve,
  onChanged,
  onClose,
}: {
  sheetId: string;
  thread: Thread;
  comments: CellComment[];
  canResolve: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const left = Math.min(thread.x, window.innerWidth - 336);
  const top = Math.min(thread.y + 8, window.innerHeight - 380);

  async function send() {
    setBusy(true);
    const result = await addCellComment({ sheetId, rowId: thread.rowId, columnId: thread.columnId, body });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setBody("");
    setError("");
    onChanged();
  }

  async function resolve() {
    setBusy(true);
    const result = await resolveCellComments({ sheetId, rowId: thread.rowId, columnId: thread.columnId });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onChanged();
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-50" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Cell comments"
        dir="ltr"
        className="absolute flex max-h-[360px] w-80 flex-col rounded-xl border border-border bg-surface p-3 text-sm shadow-2xl"
        style={{ left: Math.max(8, left), top: Math.max(8, top) }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.key === "Escape" && onClose()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Comments</h2>
          <div className="flex items-center gap-1">
            {canResolve && comments.length > 0 ? (
              <button
                type="button"
                disabled={busy}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs text-success hover:bg-success/10 disabled:opacity-50"
                onClick={() => void resolve()}
              >
                <Check className="size-3.5" aria-hidden="true" /> Resolve
              </button>
            ) : null}
            <button type="button" aria-label="Close comments" className="cursor-pointer rounded p-1 hover:bg-row" onClick={onClose}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <ul className="min-h-0 flex-1 space-y-2 overflow-auto">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-2">
              <span
                aria-hidden="true"
                className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white"
                style={{ backgroundColor: comment.authorColor }}
              >
                {(comment.authorName[0] ?? "?").toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-xs text-muted">
                  <span className="font-medium text-text">{comment.authorName}</span> ·{" "}
                  {new Date(comment.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
                <p dir="auto" className="whitespace-pre-wrap break-words">
                  {comment.body}
                </p>
              </div>
            </li>
          ))}
          {comments.length === 0 ? <li className="text-muted">No comments on this cell yet.</li> : null}
        </ul>
        <textarea
          autoFocus
          dir="auto"
          rows={2}
          value={body}
          maxLength={2000}
          placeholder={comments.length > 0 ? "Reply…" : "Add a comment…"}
          aria-label="Comment"
          className="mt-2 w-full rounded-md border border-border bg-surface px-2 py-1.5 outline-none focus:border-primary"
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void send();
            }
          }}
        />
        {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            disabled={busy || !body.trim()}
            className="cursor-pointer rounded-md bg-primary px-3 py-1 font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            onClick={() => void send()}
          >
            Comment
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
