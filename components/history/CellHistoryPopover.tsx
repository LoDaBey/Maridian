"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { CellHistoryEntry } from "@/lib/sheets/activity-repo";
import type { JsonValue } from "@/lib/sheets/ops";
import { useSheetDispatch } from "@/lib/realtime/sheet-session";
import { useSheetStore } from "@/stores/sheet-store";

export function CellHistoryPopover({
  sheetId,
  rowId,
  columnId,
  x,
  y,
  canRestore,
  onClose,
}: {
  sheetId: string;
  rowId: string;
  columnId: string;
  x: number;
  y: number;
  canRestore: boolean;
  onClose: () => void;
}) {
  const dispatch = useSheetDispatch();
  const store = useSheetStore();
  const version = useStore(store, (state) => state.version);
  const [entries, setEntries] = useState<CellHistoryEntry[]>([]);
  const [error, setError] = useState("");
  const [loadedFor, setLoadedFor] = useState("");
  const requestKey = `${sheetId}:${rowId}:${columnId}:${version}`;

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/sheets/${sheetId}/cells/${rowId}/${columnId}/history`)
      .then(async (response) => {
        const body = (await response.json()) as { entries?: CellHistoryEntry[]; error?: string };
        if (cancelled) {
          return;
        }
        if (!response.ok || !body.entries) {
          setError(body.error || "Could not load cell history.");
          return;
        }
        setEntries(body.entries);
        setError("");
        setLoadedFor(`${sheetId}:${rowId}:${columnId}:${version}`);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load cell history.");
          setLoadedFor(`${sheetId}:${rowId}:${columnId}:${version}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sheetId, rowId, columnId, version]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    function onPointer(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-cell-history]")) {
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [onClose]);

  const left = Math.max(8, Math.min(x, window.innerWidth - 320));
  const top = Math.max(8, Math.min(y, window.innerHeight - 280));

  function restore(value: JsonValue | null) {
    dispatch("cell.set", { rowId, columnId, value });
  }

  return (
    <div
      role="dialog"
      aria-label="Cell history"
      data-cell-history="true"
      style={{ position: "fixed", left, top }}
      className="z-50 max-h-80 w-80 overflow-auto rounded-lg border border-border bg-surface p-3 text-sm shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Cell history</h2>
        <button type="button" aria-label="Close cell history" className="cursor-pointer rounded-lg px-2 py-1" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      {loadedFor !== requestKey && !error ? <p className="text-muted">Loading history</p> : null}
      {loadedFor === requestKey && entries.length === 0 && !error ? <p className="text-muted">No changes yet.</p> : null}
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li key={entry.id} className="border-t border-border pt-2">
            <p>
              <strong>{entry.userName}</strong> changed this cell from <em>{entry.oldText || "empty"}</em> → <em>{entry.newText || "empty"}</em>
            </p>
            <p className="mt-1 flex items-center gap-2 text-xs text-muted">
              <time dateTime={entry.createdAt} title={new Date(entry.createdAt).toLocaleString()}>
                {new Date(entry.createdAt).toLocaleString()}
              </time>
              {canRestore ? (
                <button
                  type="button"
                  aria-label={`Restore ${entry.oldText || "empty"}`}
                  className="cursor-pointer rounded-lg text-primary"
                  onClick={() => restore(entry.oldValue)}
                >
                  Restore
                </button>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
