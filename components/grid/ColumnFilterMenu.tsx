"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { ColumnType } from "@/lib/db-types";
import type { JsonValue } from "@/lib/sheets/ops";
import { collectColumnFilterValues, upsertValueFilter, type FilterRule, type SortRule } from "@/lib/sheets/view";
import { useSheetStore } from "@/stores/sheet-store";

export function ColumnFilterMenu({
  columnId,
  columnName,
  column,
  usersById,
  filters,
  sort,
  x,
  y,
  onFilters,
  onSort,
  onClose,
}: {
  columnId: string;
  columnName: string;
  column: { id: string; type: ColumnType; settings?: Record<string, JsonValue> };
  usersById: ReadonlyMap<string, string>;
  filters: FilterRule[];
  sort: SortRule | null;
  x: number;
  y: number;
  onFilters: (filters: FilterRule[]) => void;
  onSort: (sort: SortRule | null) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(x);
  const [top, setTop] = useState(y);
  const store = useSheetStore();
  const rows = useStore(store, (state) => state.rows);
  const rowOrder = useStore(store, (state) => state.rowOrder);
  const options = useMemo(
    () => collectColumnFilterValues(rows, rowOrder, column, usersById),
    [rows, rowOrder, column, usersById],
  );
  const applied = filters.find((rule) => rule.columnId === columnId && rule.operator === "in_values");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(applied?.values ?? options.map((option) => option.key)));

  useEffect(() => {
    const node = menuRef.current;
    if (!node) {
      return;
    }
    if (!node.matches(":popover-open")) {
      node.showPopover();
    }
    const width = node.offsetWidth || 288;
    const height = node.offsetHeight || 320;
    setLeft(Math.max(8, Math.min(x, window.innerWidth - width - 8)));
    setTop(Math.max(8, Math.min(y, window.innerHeight - height - 8)));
    return () => {
      if (node.matches(":popover-open")) {
        node.hidePopover();
      }
    };
  }, [x, y]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return options;
    }
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  function toggle(key: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function selectVisible(on: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      for (const option of visible) {
        if (on) {
          next.add(option.key);
        } else {
          next.delete(option.key);
        }
      }
      return next;
    });
  }

  return (
    <div
      ref={menuRef}
      popover="manual"
      role="dialog"
      aria-label={`Filter ${columnName}`}
      data-column-filter-menu="true"
      style={{
        position: "fixed",
        left,
        top,
        right: "auto",
        bottom: "auto",
        margin: 0,
      }}
      className="z-50 flex w-72 flex-col rounded-lg border border-border bg-surface text-sm text-text shadow-lg"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex flex-col border-b border-border p-1">
        <button
          type="button"
          aria-label={`Sort ${columnName} A to Z`}
          className={`flex w-full cursor-pointer rounded-lg px-2 py-1.5 text-start outline-none hover:bg-row ${sort?.columnId === columnId && sort.direction === "asc" ? "bg-primary/10" : ""}`}
          onClick={() => onSort({ columnId, direction: "asc" })}
        >
          Sort A to Z
        </button>
        <button
          type="button"
          aria-label={`Sort ${columnName} Z to A`}
          className={`flex w-full cursor-pointer rounded-lg px-2 py-1.5 text-start outline-none hover:bg-row ${sort?.columnId === columnId && sort.direction === "desc" ? "bg-primary/10" : ""}`}
          onClick={() => onSort({ columnId, direction: "desc" })}
        >
          Sort Z to A
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={`Select all ${columnName} values`}
            className="cursor-pointer rounded-lg text-primary outline-none"
            onClick={() => selectVisible(true)}
          >
            Select all
          </button>
          <span className="text-muted">·</span>
          <button
            type="button"
            aria-label={`Clear ${columnName} values`}
            className="cursor-pointer rounded-lg text-primary outline-none"
            onClick={() => selectVisible(false)}
          >
            Clear
          </button>
        </div>
        <span className="text-xs text-muted">Displaying {visible.length}</span>
      </div>
      <div className="px-3 pb-2">
        <input
          aria-label={`Search ${columnName} values`}
          value={query}
          placeholder="Search"
          className="h-8 w-full rounded border border-border px-2 outline-none"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <ul className="max-h-52 overflow-auto px-2 pb-2">
        {visible.length === 0 ? (
          <li className="px-2 py-1.5 text-muted">No values</li>
        ) : (
          visible.map((option) => {
            const checked = selected.has(option.key);
            return (
              <li key={option.key}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 hover:bg-row">
                  <input
                    type="checkbox"
                    checked={checked}
                    aria-label={option.label}
                    className="rounded outline-none"
                    onChange={() => toggle(option.key)}
                  />
                  <span className="truncate">{option.label}</span>
                </label>
              </li>
            );
          })
        )}
      </ul>
      <div className="flex justify-end gap-2 border-t border-border px-3 py-2">
        <button
          type="button"
          aria-label={`Cancel ${columnName} filter`}
          className="cursor-pointer rounded-lg border border-border px-3 py-1.5 outline-none"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          aria-label={`Apply ${columnName} filter`}
          className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 font-medium text-white outline-none"
          onClick={() => {
            onFilters(upsertValueFilter(filters, columnId, [...selected], options.map((option) => option.key)));
            onClose();
          }}
        >
          OK
        </button>
      </div>
    </div>
  );
}
