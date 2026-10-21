"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Download, Filter, History, Import, Share2, SortAsc, UserRound } from "lucide-react";
import { useStore } from "zustand";
import { ShareWorkbookDialog } from "@/app/(app)/_components/ShareWorkbookDialog";
import { ImportDialog } from "@/app/(app)/s/[sheetId]/_components/ImportDialog";
import { ActivityDrawer } from "@/components/history/ActivityDrawer";
import { Tooltip } from "@/components/ui/Tooltip";
import type { ColumnType } from "@/lib/db-types";
import type { JsonValue } from "@/lib/sheets/ops";
import { deriveRowOrder, formatRowCount, type FilterRule, type SortRule } from "@/lib/sheets/view";
import { useSheetStore } from "@/stores/sheet-store";
import { useMe, canDo } from "./MeContext";
import type { DirectoryUser } from "./types";

export function Toolbar({
  direction,
  columns,
  users,
  workbookId,
  workbookName,
  search,
  filters,
  sort,
  mine,
  today,
  shown,
  total,
  onSearch,
  onSort,
  onMine,
  onToday,
  onClear,
  filterActive,
  onFilterActive,
}: {
  direction: "ltr" | "rtl";
  columns: Array<{ id: string; name: string; type: ColumnType; settings: Record<string, JsonValue> }>;
  users: DirectoryUser[];
  workbookId: string;
  workbookName: string;
  search: string;
  filters: FilterRule[];
  sort: SortRule | null;
  mine: boolean;
  today: boolean;
  shown: number;
  total: number;
  onSearch: (value: string) => void;
  onSort: (sort: SortRule | null) => void;
  onMine: (value: boolean) => void;
  onToday: (value: boolean) => void;
  onClear: () => void;
  filterActive: boolean;
  onFilterActive: (value: boolean) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const store = useSheetStore();
  const sheet = useStore(store, (state) => state.sheet);
  const archived = useStore(store, (state) => state.archived);
  const me = useMe();
  const canImport = canDo(me, "csv.import") && !archived;
  const [sortOpen, setSortOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const canHistory = canDo(me, "history.view");
  const [exportError, setExportError] = useState("");
  const active = Boolean(search.trim() || filters.length || sort || mine || today);
  const filterCount = filters.length + Number(mine) + Number(today);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!sortOpen && !exportOpen) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-view-popover]")) {
        return;
      }
      setSortOpen(false);
      setExportOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [sortOpen, exportOpen]);

  async function download(scope: "all" | "view") {
    setExportOpen(false);
    setExportError("");
    const state = store.getState();
    const usersById = new Map(users.map((user) => [user.id, user.fullName]));
    const rowIds =
      scope === "view"
        ? deriveRowOrder(
            state.rows,
            state.rowOrder,
            columns,
            { search, filters, sort, mine, today },
            { id: me.id },
            usersById,
          )
        : undefined;
    const response = await fetch(`/api/sheets/${state.sheet.id}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scope === "view" ? { scope, rowIds } : { scope: "all" }),
    });
    if (!response.ok) {
      setExportError("Could not export this sheet.");
      return;
    }
    const blob = await response.blob();
    const header = response.headers.get("Content-Disposition");
    const encoded = header?.split("filename*=UTF-8''")[1];
    let filename = `${state.sheet.name}.csv`;
    if (encoded) {
      try {
        filename = decodeURIComponent(encoded);
      } catch {
        filename = `${state.sheet.name}.csv`;
      }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
    <div dir={direction} className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-2 text-sm">
      <input
        ref={searchRef}
        value={search}
        aria-label="Search rows"
        placeholder="Search"
        className="h-8 w-56 rounded-lg border border-border px-2 outline-none"
        onChange={(event) => onSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onSearch("");
          }
        }}
      />
      <Tooltip label="Filter">
        <button
          type="button"
          aria-label="Filter"
          aria-pressed={filterActive}
          className={`relative inline-flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-row ${filterActive ? "bg-primary/10 text-primary" : "text-muted hover:text-text"}`}
          onClick={() => {
            setSortOpen(false);
            onFilterActive(!filterActive);
          }}
        >
          <Filter className="size-4" aria-hidden="true" />
          {filterCount > 0 ? (
            <span className="absolute -end-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-white">
              {filterCount}
            </span>
          ) : null}
        </button>
      </Tooltip>
      <div className="relative" data-view-popover="true">
        <Tooltip label="Sort" disabled={sortOpen}>
          <button
            type="button"
            aria-label="Sort"
            aria-expanded={sortOpen}
            aria-pressed={sort !== null}
            className={`inline-flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-row ${sort ? "bg-primary/10 text-primary" : "text-muted hover:text-text"}`}
            onClick={() => {
              setSortOpen((open) => !open);
            }}
          >
            <SortAsc className="size-4" aria-hidden="true" />
          </button>
        </Tooltip>
        {sortOpen ? (
          <div
            role="menu"
            aria-label="Sort rows"
            className="absolute start-0 top-full z-40 mt-1 max-h-80 w-56 overflow-auto rounded-lg border border-border bg-surface p-1 shadow-lg"
          >
            {columns.map((column) => {
              const selected = sort?.columnId === column.id;
              const directionLabel = selected && sort.direction === "desc" ? "descending" : "ascending";
              return (
                <button
                  key={column.id}
                  type="button"
                  role="menuitem"
                  aria-label={`Sort by ${column.name}`}
                  className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-start outline-none hover:bg-row ${selected ? "bg-primary/10" : ""}`}
                  onClick={() => {
                    if (!selected) {
                      onSort({ columnId: column.id, direction: "asc" });
                      return;
                    }
                    onSort(sort.direction === "asc" ? { columnId: column.id, direction: "desc" } : null);
                  }}
                >
                  <span className="truncate">{column.name}</span>
                  {selected ? <span className="text-xs text-muted">{directionLabel}</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <Tooltip label="My rows">
        <button
          type="button"
          aria-label="My rows"
          aria-pressed={mine}
          className={`inline-flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-row ${mine ? "bg-primary/10 text-primary" : "text-muted hover:text-text"}`}
          onClick={() => onMine(!mine)}
        >
          <UserRound className="size-4" aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip label="Today">
        <button
          type="button"
          aria-label="Today"
          aria-pressed={today}
          className={`inline-flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-row ${today ? "bg-primary/10 text-primary" : "text-muted hover:text-text"}`}
          onClick={() => onToday(!today)}
        >
          <CalendarDays className="size-4" aria-hidden="true" />
        </button>
      </Tooltip>
      {canImport ? (
        <Tooltip label="Import">
          <button
            type="button"
            aria-label="Import"
            className="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-row hover:text-text"
            onClick={() => setImportOpen(true)}
          >
            <Import className="size-4" aria-hidden="true" />
          </button>
        </Tooltip>
      ) : null}
      <div className="relative" data-view-popover="true">
        <Tooltip label="Export" disabled={exportOpen}>
          <button
            type="button"
            aria-label="Export"
            aria-expanded={exportOpen}
            className="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-row hover:text-text"
            onClick={() => {
              setSortOpen(false);
              setExportOpen((open) => !open);
            }}
          >
            <Download className="size-4" aria-hidden="true" />
          </button>
        </Tooltip>
        {exportOpen ? (
          <div role="menu" aria-label="Export rows" className="absolute start-0 top-full z-40 mt-1 w-44 rounded-lg border border-border bg-surface p-1 shadow-lg">
            <button
              type="button"
              role="menuitem"
              aria-label="Export all rows"
              className="flex w-full cursor-pointer rounded-lg px-2 py-1.5 text-start outline-none hover:bg-row"
              onClick={() => void download("all")}
            >
              All rows
            </button>
            <button
              type="button"
              role="menuitem"
              aria-label="Export current view"
              className="flex w-full cursor-pointer rounded-lg px-2 py-1.5 text-start outline-none hover:bg-row"
              onClick={() => void download("view")}
            >
              Current view
            </button>
          </div>
        ) : null}
      </div>
      {canHistory ? (
        <Tooltip label="History" disabled={historyOpen}>
          <button
            type="button"
            aria-label="History"
            aria-pressed={historyOpen}
            className={`inline-flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-row ${historyOpen ? "bg-primary/10 text-primary" : "text-muted hover:text-text"}`}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <History className="size-4" aria-hidden="true" />
          </button>
        </Tooltip>
      ) : null}
      <Tooltip label="Share" disabled={shareOpen}>
        <button
          type="button"
          aria-label="Share sheet"
          aria-pressed={shareOpen}
          className={`inline-flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-row ${shareOpen ? "bg-primary/10 text-primary" : "text-muted hover:text-text"}`}
          onClick={() => setShareOpen(true)}
        >
          <Share2 className="size-4" aria-hidden="true" />
        </button>
      </Tooltip>
      {exportError ? (
        <p role="alert" className="text-xs text-danger">
          {exportError}
        </p>
      ) : null}
      {active ? (
        <p className="ms-auto flex items-center gap-2 text-xs text-muted">
          <span>
            Showing {formatRowCount(shown)} of {formatRowCount(total)} rows
          </span>
          <button type="button" aria-label="Clear all" className="cursor-pointer rounded-lg px-2 py-1 text-primary" onClick={onClear}>
            Clear all
          </button>
        </p>
      ) : null}
    </div>
    <ImportDialog
      open={importOpen}
      sheetId={sheet.id}
      sheetName={sheet.name}
      columns={columns}
      onClose={() => setImportOpen(false)}
    />
    <ActivityDrawer open={historyOpen} sheetId={sheet.id} direction={direction} users={users} onClose={() => setHistoryOpen(false)} />
    <ShareWorkbookDialog
      open={shareOpen}
      workbookId={workbookId}
      workbookName={workbookName}
      onClose={() => setShareOpen(false)}
    />
    </>
  );
}
