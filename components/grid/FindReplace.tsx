"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { LocalColumn, LocalRow } from "@/lib/sheets/apply-local";
import type { JsonValue } from "@/lib/sheets/ops";
import { displayValue } from "@/lib/sheets/values";

/** Column types whose stored value is plain text, so it can be replaced in place. */
const REPLACEABLE = new Set(["text", "long_text", "email", "phone"]);

export interface FindMatch {
  rowId: string;
  columnId: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Ctrl+F / Ctrl+H: find in the visible rows, step through matches, replace one or all. */
export function FindReplace({
  rows,
  rowIds,
  columns,
  usersById,
  canReplace,
  isLocked,
  onGoTo,
  onReplace,
  onClose,
}: {
  rows: Record<string, LocalRow>;
  rowIds: string[];
  columns: LocalColumn[];
  usersById: ReadonlyMap<string, string>;
  canReplace: boolean;
  /** Protected cells are skipped when replacing. */
  isLocked: (rowId: string, columnId: string) => boolean;
  onGoTo: (match: FindMatch) => void;
  onReplace: (cells: Array<{ rowId: string; columnId: string; value: JsonValue | null }>) => void;
  onClose: () => void;
}) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeCell, setWholeCell] = useState(false);
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const pattern = useMemo(() => {
    if (!find) {
      return null;
    }
    const body = escapeRegExp(find);
    // Not global, so test() keeps no state between cells; replacing builds its own global copy.
    return new RegExp(wholeCell ? `^${body}$` : body, matchCase ? "" : "i");
  }, [find, matchCase, wholeCell]);

  const matches = useMemo<FindMatch[]>(() => {
    if (!pattern) {
      return [];
    }
    const found: FindMatch[] = [];
    for (const rowId of rowIds) {
      const row = rows[rowId];
      if (!row) {
        continue;
      }
      for (const column of columns) {
        const text = displayValue(column, row.data[column.id], usersById);
        if (text && pattern.test(text)) {
          found.push({ rowId, columnId: column.id });
        }
      }
      if (found.length >= 10_000) {
        break;
      }
    }
    return found;
  }, [pattern, rows, rowIds, columns, usersById]);

  const current = matches.length > 0 ? Math.min(index, matches.length - 1) : -1;

  function step(delta: number) {
    if (matches.length === 0) {
      return;
    }
    const next = (current + delta + matches.length) % matches.length;
    setIndex(next);
    onGoTo(matches[next]!);
  }

  function replaced(match: FindMatch): { rowId: string; columnId: string; value: JsonValue | null } | null {
    const column = columns.find((item) => item.id === match.columnId);
    const value = rows[match.rowId]?.data[match.columnId];
    if (!column || !pattern || !REPLACEABLE.has(column.type) || typeof value !== "string" || isLocked(match.rowId, match.columnId)) {
      return null;
    }
    const next = value.replace(new RegExp(pattern.source, `${pattern.flags}g`), () => replace);
    return next === value ? null : { rowId: match.rowId, columnId: match.columnId, value: next === "" ? null : next };
  }

  function replaceOne() {
    const match = matches[current];
    const cell = match ? replaced(match) : null;
    if (!cell) {
      setNotice("This match can't be replaced (not a text cell, or protected).");
      step(1);
      return;
    }
    onReplace([cell]);
    setNotice("");
  }

  function replaceAll() {
    const cells = matches.map(replaced).filter((cell): cell is NonNullable<typeof cell> => cell !== null);
    if (cells.length === 0) {
      setNotice("Nothing to replace in text cells.");
      return;
    }
    onReplace(cells);
    const skipped = matches.length - cells.length;
    setNotice(`Replaced ${cells.length.toLocaleString("en-US")} cell${cells.length === 1 ? "" : "s"}${skipped > 0 ? `; skipped ${skipped} that aren't text or are protected` : ""}.`);
  }

  return (
    <div
      role="dialog"
      aria-label="Find and replace"
      dir="ltr"
      className="absolute end-4 top-2 z-40 w-80 rounded-xl border border-border bg-surface p-3 text-sm shadow-xl"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">{canReplace ? "Find and replace" : "Find"}</h2>
        <button type="button" aria-label="Close find" className="cursor-pointer rounded p-1 hover:bg-row" onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          dir="auto"
          value={find}
          placeholder="Find"
          aria-label="Find"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 outline-none focus:border-primary"
          onChange={(event) => {
            setFind(event.target.value);
            setIndex(0);
            setNotice("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            }
          }}
        />
        <span className="w-16 shrink-0 text-center text-xs tabular-nums text-muted" aria-live="polite">
          {find ? `${current + 1 > 0 ? current + 1 : 0} of ${matches.length >= 10_000 ? "10k+" : matches.length}` : ""}
        </span>
        <button type="button" aria-label="Previous match" className="cursor-pointer rounded p-1 hover:bg-row" onClick={() => step(-1)}>
          <ChevronUp className="size-4" aria-hidden="true" />
        </button>
        <button type="button" aria-label="Next match" className="cursor-pointer rounded p-1 hover:bg-row" onClick={() => step(1)}>
          <ChevronDown className="size-4" aria-hidden="true" />
        </button>
      </div>
      {canReplace ? (
        <input
          dir="auto"
          value={replace}
          placeholder="Replace with"
          aria-label="Replace with"
          className="mt-2 w-full rounded-md border border-border bg-surface px-2 py-1 outline-none focus:border-primary"
          onChange={(event) => setReplace(event.target.value)}
        />
      ) : null}
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" className="accent-primary" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} />
          Match case
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" className="accent-primary" checked={wholeCell} onChange={(event) => setWholeCell(event.target.checked)} />
          Entire cell
        </label>
      </div>
      {notice ? <p className="mt-2 text-xs text-muted">{notice}</p> : null}
      {canReplace ? (
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            disabled={matches.length === 0}
            className="cursor-pointer rounded-md border border-border px-2.5 py-1 hover:bg-row disabled:opacity-50"
            onClick={replaceOne}
          >
            Replace
          </button>
          <button
            type="button"
            disabled={matches.length === 0}
            className="cursor-pointer rounded-md bg-primary px-2.5 py-1 font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            onClick={replaceAll}
          >
            Replace all
          </button>
        </div>
      ) : null}
    </div>
  );
}
