"use client";

import { useEffect, useRef, useState } from "react";
import type { ActivityEntry } from "@/lib/sheets/activity-repo";
import { deriveRowOrder } from "@/lib/sheets/view";
import { getSocket } from "@/lib/realtime/client";
import { useViewState } from "@/components/grid/useViewState";
import type { DirectoryUser } from "@/components/grid/types";
import { usePresencePeople } from "@/stores/presence-store";
import { useColumns, useSheetStore } from "@/stores/sheet-store";

export function ActivityDrawer({
  open,
  sheetId,
  direction,
  users,
  onClose,
}: {
  open: boolean;
  sheetId: string;
  direction: "ltr" | "rtl";
  users: DirectoryUser[];
  onClose: () => void;
}) {
  const store = useSheetStore();
  const columns = useColumns();
  const view = useViewState(sheetId);
  const meId = usePresencePeople().find((person) => person.you)?.userId ?? null;
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [error, setError] = useState("");
  const [settled, setSettled] = useState(false);
  const [fresh, setFresh] = useState(0);
  const [gone, setGone] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: "50" });
    if (userId) {
      params.set("userId", userId);
    }
    loadingRef.current = true;
    void fetch(`/api/sheets/${sheetId}/activity?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as ActivityResponse;
        if (!response.ok || !body.entries) {
          setError(body.error || "Could not load activity.");
          return;
        }
        setEntries(dedupe(body.entries));
        setNextBefore(body.nextBefore ?? null);
        setFresh(0);
        setGone(null);
        setError("");
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }
        setError("Could not load activity.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          loadingRef.current = false;
          setSettled(true);
        }
      });
    return () => {
      controller.abort();
      loadingRef.current = false;
    };
  }, [open, sheetId, userId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const socket = getSocket();
    const onApplied = (payload: unknown) => {
      if (!payload || typeof payload !== "object" || !("op" in payload)) {
        return;
      }
      const op = (payload as { op?: { sheetId?: string; type?: string; payload?: unknown } }).op;
      if (!op || op.sheetId !== sheetId) {
        return;
      }
      setFresh((count) => count + changeCount(op.type, op.payload));
    };
    socket.on("op:applied", onApplied);
    return () => {
      socket.off("op:applied", onApplied);
    };
  }, [open, sheetId]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollerRef.current;
    if (!open || !sentinel || !root || !nextBefore) {
      return;
    }
    const observer = new IntersectionObserver(
      (observed) => {
        if (!observed.some((entry) => entry.isIntersecting) || loadingRef.current || !nextBefore) {
          return;
        }
        loadingRef.current = true;
        const params = new URLSearchParams({ limit: "50", before: nextBefore });
        if (userId) {
          params.set("userId", userId);
        }
        void fetch(`/api/sheets/${sheetId}/activity?${params.toString()}`)
          .then(async (response) => {
            const body = (await response.json()) as ActivityResponse;
            const page = body.entries;
            if (!response.ok || !page) {
              setError(body.error || "Could not load activity.");
              return;
            }
            setEntries((current) => dedupe([...current, ...page]));
            setNextBefore(body.nextBefore ?? null);
          })
          .catch(() => {
            setError("Could not load activity.");
          })
          .finally(() => {
            loadingRef.current = false;
          });
      },
      { root, rootMargin: "160px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [open, nextBefore, entries.length, sheetId, userId]);

  function reload() {
    setSettled(false);
    const params = new URLSearchParams({ limit: "50" });
    if (userId) {
      params.set("userId", userId);
    }
    void fetch(`/api/sheets/${sheetId}/activity?${params.toString()}`)
      .then(async (response) => {
        const body = (await response.json()) as ActivityResponse;
        if (!response.ok || !body.entries) {
          setError(body.error || "Could not load activity.");
          return;
        }
        setEntries(dedupe(body.entries));
        setNextBefore(body.nextBefore ?? null);
        setFresh(0);
        setError("");
      })
      .catch(() => {
        setError("Could not load activity.");
      })
      .finally(() => {
        setSettled(true);
      });
  }

  function goTo(entry: ActivityEntry) {
    if (!entry.rowId || !entry.columnId) {
      return;
    }
    const state = store.getState();
    const row = state.rows[entry.rowId];
    if (!row || row.deleted) {
      setGone(entry.id);
      return;
    }
    const usersById = new Map(users.map((user) => [user.id, user.fullName]));
    const visible = deriveRowOrder(
      state.rows,
      state.rowOrder,
      columns,
      { search: view.search, filters: view.filters, sort: view.sort, mine: view.mine, today: view.today },
      { id: meId },
      usersById,
    );
    const index = visible.indexOf(entry.rowId);
    const grid = document.querySelector<HTMLElement>("[role='grid']");
    if (grid && index >= 0) {
      grid.scrollTop = Math.max(0, index * 36);
    }
    window.setTimeout(() => {
      const cell = document.querySelector<HTMLElement>(
        `[data-row-id="${CSS.escape(entry.rowId ?? "")}"][data-column-id="${CSS.escape(entry.columnId ?? "")}"]`,
      );
      if (!cell) {
        return;
      }
      cell.scrollIntoView({ block: "center", inline: "nearest" });
      cell.style.animation = "presence-flash 0.6s ease-in-out 2";
      window.setTimeout(() => {
        cell.style.animation = "";
      }, 1400);
    }, 50);
  }

  if (!open) {
    return null;
  }

  const groups = groupEntries(entries);

  return (
    <aside dir={direction} className="fixed inset-y-0 end-0 z-40 flex w-[min(24rem,100vw)] flex-col border-s border-border bg-surface shadow-xl">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Activity</h2>
        <select
          aria-label="Filter activity by person"
          value={userId}
          onChange={(event) => {
            setUserId(event.target.value);
            setEntries([]);
            setNextBefore(null);
            setSettled(false);
            setError("");
          }}
          className="ms-auto max-w-40 rounded border border-border px-2 py-1 text-sm outline-none"
        >
          <option value="">Everyone</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.fullName}
            </option>
          ))}
        </select>
        <button type="button" aria-label="Close activity" className="cursor-pointer rounded-lg px-2 py-1" onClick={onClose}>
          Close
        </button>
      </div>
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {fresh > 0 ? (
          <button
            type="button"
            aria-label={`${fresh} new ${fresh === 1 ? "change" : "changes"}, refresh`}
            className="mb-2 w-full cursor-pointer rounded-lg bg-primary/10 px-3 py-1.5 text-sm text-primary"
            onClick={reload}
          >
            {fresh} new {fresh === 1 ? "change" : "changes"}, refresh
          </button>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {settled && groups.length === 0 ? <p className="text-sm text-muted">No activity yet.</p> : null}
        <ul className="flex flex-col gap-3">
          {groups.map((group) => (
            <li key={group.id} className="text-sm">
              <div className="flex gap-2">
                <Avatar name={group.userName} color={group.avatarColor} />
                <div className="min-w-0 flex-1">
                  {group.kind === "cells" && group.entries.length > 1 ? (
                    <p>
                      <strong>{group.userName}</strong> {group.summary}
                    </p>
                  ) : null}
                  {group.kind === "import" && group.entries.length > 1 ? <p>Imported {group.entries.length} rows</p> : null}
                  {group.kind === "paste" && group.entries.length > 1 ? <p>Pasted {group.entries.length} cells</p> : null}
                  {group.kind === "cells" || group.kind === "other" || group.entries.length === 1 ? (
                    <ul className="flex flex-col gap-2">
                      {group.entries.map((entry) => (
                        <li key={entry.id}>
                          <p>
                            <strong>{entry.userName}</strong> <EntrySentence entry={entry} />
                          </p>
                          <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                            <time dateTime={entry.createdAt} title={absoluteTime(entry.createdAt)}>
                              {relativeTime(entry.createdAt)}
                            </time>
                            {entry.rowId && entry.columnId ? (
                              gone === entry.id || entry.rowDeleted ? (
                                <span>row deleted</span>
                              ) : (
                                <button type="button" aria-label={`Go to ${entry.columnName ?? "cell"}`} className="cursor-pointer rounded-lg text-primary" onClick={() => goTo(entry)}>
                                  Go to cell
                                </button>
                              )
                            ) : null}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted">
                      <time dateTime={group.createdAt} title={absoluteTime(group.createdAt)}>
                        {relativeTime(group.createdAt)}
                      </time>
                    </p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div ref={sentinelRef} className="h-6" />
        {!settled ? <p className="text-xs text-muted">Loading activity</p> : null}
      </div>
    </aside>
  );
}

interface ActivityResponse {
  entries?: ActivityEntry[];
  nextBefore?: string | null;
  error?: string;
}

function dedupe(entries: ActivityEntry[]): ActivityEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
}

function EntrySentence({ entry }: { entry: ActivityEntry }) {
  const column = entry.columnName ?? "a column";
  const row = entry.rowNumber ? `row ${entry.rowNumber}` : entry.rowDeleted ? "a deleted row" : "a row";
  if (entry.action === "cell.set" || entry.action === "cells.setMany" || (entry.action === "column.update" && entry.rowId)) {
    return (
      <>
        changed <strong>{column}</strong> on {row} from <em>{entry.oldText || "empty"}</em>
        {" → "}
        <em>{entry.newText || "empty"}</em>
      </>
    );
  }
  if (entry.action === "row.insert" || entry.action === "rows.insertMany") {
    return <>inserted {row}</>;
  }
  if (entry.action === "row.delete") {
    return <>deleted a row</>;
  }
  if (entry.action === "column.delete") {
    return (
      <>
        deleted column <strong>{column}</strong>
      </>
    );
  }
  if (entry.action === "column.insert") {
    return (
      <>
        added column <strong>{column}</strong>
      </>
    );
  }
  if (entry.action === "column.update") {
    return (
      <>
        updated column <strong>{column}</strong>
      </>
    );
  }
  return <>updated {column}</>;
}

interface ActivityGroup {
  id: string;
  kind: "cells" | "import" | "paste" | "other";
  userName: string;
  avatarColor: string;
  summary: string;
  createdAt: string;
  entries: ActivityEntry[];
}

function groupEntries(entries: ActivityEntry[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const entry of entries) {
    const previous = groups[groups.length - 1];
    const kind = groupKind(entry);
    const close = previous && previous.userName === entry.userName && previous.kind === kind && withinMinute(previous.createdAt, entry.createdAt);
    if (previous && close && (kind === "cells" || kind === "import" || kind === "paste")) {
      previous.entries.push(entry);
      previous.summary = summaryFor(kind, previous.entries.length);
      continue;
    }
    groups.push({
      id: entry.id,
      kind,
      userName: entry.userName,
      avatarColor: entry.avatarColor,
      summary: summaryFor(kind, 1),
      createdAt: entry.createdAt,
      entries: [entry],
    });
  }
  return groups;
}

function groupKind(entry: ActivityEntry): ActivityGroup["kind"] {
  if (entry.action === "cells.setMany") {
    return "paste";
  }
  if (entry.action === "rows.insertMany") {
    return "import";
  }
  if (entry.action === "cell.set" || (entry.action === "column.update" && entry.rowId)) {
    return "cells";
  }
  return "other";
}

function summaryFor(kind: ActivityGroup["kind"], count: number): string {
  if (kind === "import") {
    return count === 1 ? "imported 1 row" : `imported ${count} rows`;
  }
  if (kind === "paste") {
    return count === 1 ? "pasted 1 cell" : `pasted ${count} cells`;
  }
  return count === 1 ? "edited 1 cell" : `edited ${count} cells`;
}

function withinMinute(left: string, right: string): boolean {
  return Math.abs(new Date(left).getTime() - new Date(right).getTime()) <= 60_000;
}

function changeCount(type: string | undefined, payload: unknown): number {
  if (!payload || typeof payload !== "object") {
    return 1;
  }
  if (type === "rows.insertMany" && "rows" in payload && Array.isArray(payload.rows)) {
    return payload.rows.length || 1;
  }
  if (type === "cells.setMany" && "cells" in payload && Array.isArray(payload.cells)) {
    return payload.cells.length || 1;
  }
  return 1;
}

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function Avatar({ name, color }: { name: string; color: string }) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const letters = parts.map((part) => part[0] ?? "").join("").toUpperCase() || "?";
  return (
    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] text-white" style={{ backgroundColor: color }} aria-hidden="true">
      {letters}
    </span>
  );
}
