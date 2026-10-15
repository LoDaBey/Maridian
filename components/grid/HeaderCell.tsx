"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { ChevronDown, Filter } from "lucide-react";
import { readFillColor } from "@/lib/sheets/values";
import {
  Calendar,
  CheckSquare,
  Clock,
  Hash,
  Link2,
  Type,
  UserRound,
  AlignLeft,
  CircleDot,
  Fingerprint,
  Flag,
  CalendarRange,
  ListChecks,
  Paperclip,
  Star,
  Tags,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { ColumnType, SheetDirection } from "@/lib/db-types";
import type { JsonValue, SheetOp } from "@/lib/sheets/ops";
import type { FilterRule, SortRule } from "@/lib/sheets/view";
import { PresenceDot } from "@/components/presence/PresenceDot";
import { usePresenceOnColumn } from "@/stores/presence-store";
import { ColumnFilterMenu } from "./ColumnFilterMenu";
import { ColumnMenu } from "./ColumnMenu";

const ICONS: Record<ColumnType, LucideIcon> = {
  text: Type,
  long_text: AlignLeft,
  link: Link2,
  date: Calendar,
  person: UserRound,
  status: CircleDot,
  number: Hash,
  checkbox: CheckSquare,
  created_by: UserRound,
  created_at: Calendar,
  updated_at: Clock,
  item_id: Fingerprint,
  timeline: CalendarRange,
  tags: Tags,
  dropdown: ListChecks,
  country: Flag,
  priority: TriangleAlert,
  rating: Star,
  files: Paperclip,
  due_date: Calendar,
};

let closeOpenColumnMenu: (() => void) | null = null;
let closeOpenColumnFilter: (() => void) | null = null;

export function HeaderCell({
  columnId,
  name,
  type,
  settings,
  width,
  selected,
  canResize,
  canManage,
  direction,
  index,
  columnCount,
  renaming,
  filterActive,
  filtered,
  filters,
  sort,
  usersById,
  onSelect,
  onResizeStart,
  onRenaming,
  onCommit,
  onOfferUndo,
  onFilters,
  onSort,
  canDelete,
  canStyle,
}: {
  columnId: string;
  name: string;
  type: ColumnType;
  settings: Record<string, JsonValue>;
  width: number;
  selected: boolean;
  canResize: boolean;
  canManage: boolean;
  direction: SheetDirection;
  index: number;
  columnCount: number;
  renaming: boolean;
  filterActive: boolean;
  filtered: boolean;
  filters: FilterRule[];
  sort: SortRule | null;
  usersById: ReadonlyMap<string, string>;
  onSelect: (extend: boolean) => void;
  onResizeStart: (event: MouseEvent<HTMLButtonElement>) => void;
  onRenaming: (columnId: string | null) => void;
  onCommit: (type: SheetOp["type"], payload: SheetOp["payload"]) => void;
  onOfferUndo: (message: string, undo: () => void) => void;
  onFilters: (filters: FilterRule[]) => void;
  onSort: (sort: SortRule | null) => void;
  canDelete: boolean;
  canStyle: boolean;
}) {
  const Icon = ICONS[type];
  const dots = usePresenceOnColumn(columnId);
  const headerColor = readFillColor(settings, "headerColor");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [filterOpen, setFilterOpen] = useState<{ x: number; y: number } | null>(null);
  const cancelRef = useRef(false);
  const doneRef = useRef(false);
  const closeRef = useRef<() => void>(() => undefined);
  const closeFilterRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    closeRef.current = () => setMenu(null);
  }, []);

  useEffect(() => {
    closeFilterRef.current = () => setFilterOpen(null);
  }, []);

  useEffect(() => {
    if (renaming) {
      doneRef.current = false;
      cancelRef.current = false;
    }
  }, [renaming]);

  useEffect(() => {
    if (!filterActive) {
      setFilterOpen(null);
    }
  }, [filterActive]);

  useEffect(() => {
    return () => {
      if (closeOpenColumnMenu === closeRef.current) {
        closeOpenColumnMenu = null;
      }
      if (closeOpenColumnFilter === closeFilterRef.current) {
        closeOpenColumnFilter = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!filterOpen) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest("[data-column-filter-menu]") || target.closest(`[data-column-id="${columnId}"] [aria-label="Filter ${name}"]`)) {
        return;
      }
      closeFilterRef.current();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [filterOpen, columnId, name]);

  function openMenu(x: number, y: number): void {
    if (closeOpenColumnMenu && closeOpenColumnMenu !== closeRef.current) {
      closeOpenColumnMenu();
    }
    closeOpenColumnMenu = closeRef.current;
    setMenu({ x, y });
  }

  function closeMenu(): void {
    if (closeOpenColumnMenu === closeRef.current) {
      closeOpenColumnMenu = null;
    }
    setMenu(null);
  }

  function openFilter(x: number, y: number): void {
    if (closeOpenColumnMenu) {
      closeOpenColumnMenu();
    }
    if (closeOpenColumnFilter && closeOpenColumnFilter !== closeFilterRef.current) {
      closeOpenColumnFilter();
    }
    closeOpenColumnFilter = closeFilterRef.current;
    setFilterOpen({ x, y });
  }

  function closeFilter(): void {
    if (closeOpenColumnFilter === closeFilterRef.current) {
      closeOpenColumnFilter = null;
    }
    setFilterOpen(null);
  }

  function commitName(value: string): void {
    if (doneRef.current || cancelRef.current) {
      return;
    }
    doneRef.current = true;
    const next = value.trim();
    onRenaming(null);
    if (next && next !== name) {
      onCommit("column.update", { columnId, patch: { name: next } });
    }
  }

  return (
    <div
      data-column-header="true"
      data-column-id={columnId}
      className={`group relative h-8 shrink-0 text-xs font-normal text-muted ${selected ? "bg-primary/10 text-text" : headerColor ? "" : "bg-surface"}`}
      style={{ width, backgroundColor: selected || !headerColor ? undefined : headerColor }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect(false);
        if (canManage || canDelete || canStyle) {
          closeFilter();
          openMenu(event.clientX, event.clientY);
        }
      }}
    >
      {renaming ? (
        <input
          autoFocus
          defaultValue={name}
          aria-label={`Rename ${name}`}
          maxLength={100}
          className="h-full w-full rounded bg-surface px-2 text-center outline-none"
          onFocus={(event) => event.currentTarget.select()}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancelRef.current = true;
              onRenaming(null);
            }
            if (event.key === "Enter") {
              event.preventDefault();
              commitName(event.currentTarget.value);
            }
          }}
          onBlur={(event) => commitName(event.currentTarget.value)}
        />
      ) : (
        <button
          type="button"
          aria-label={`Select ${name} column`}
          className="flex h-full w-full cursor-pointer items-center justify-center gap-1 px-2 text-center"
          onMouseDown={(event) => {
            event.preventDefault();
            if (canManage && selected && !event.shiftKey) {
              onRenaming(columnId);
              return;
            }
            onSelect(event.shiftKey);
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            if (canManage) {
              onRenaming(columnId);
            }
          }}
        >
          <Icon className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
          <span className="truncate">{name}</span>
          <PresenceDot colors={dots.colors} extra={dots.extra} />
        </button>
      )}
      {filterActive ? (
        <button
          type="button"
          aria-label={`Filter ${name}`}
          aria-haspopup="dialog"
          aria-expanded={filterOpen !== null}
          className={`absolute ${canManage ? "end-10" : "end-5"} top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded-lg p-0.5 ${filtered || filterOpen ? "text-primary" : "text-muted"}`}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (filterOpen) {
              closeFilter();
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            openFilter(rect.left, rect.bottom + 4);
          }}
        >
          <Filter className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
      {canManage ? (
        <button
          type="button"
          aria-label={`Column menu for ${name}`}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          className={`absolute end-6 top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded-lg p-0.5 text-muted ${menu ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu(rect.left, rect.bottom);
          }}
        >
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
      {canResize ? (
        <button
          type="button"
          aria-label={`Resize ${name}`}
          className="absolute end-0 top-0 z-10 h-full w-1.5 cursor-col-resize"
          onMouseDown={onResizeStart}
        />
      ) : null}
      {filterOpen ? (
        <ColumnFilterMenu
          columnId={columnId}
          columnName={name}
          column={{ id: columnId, type, settings }}
          usersById={usersById}
          filters={filters}
          sort={sort}
          x={filterOpen.x}
          y={filterOpen.y}
          onFilters={onFilters}
          onSort={onSort}
          onClose={closeFilter}
        />
      ) : null}
      {canManage || canDelete || canStyle ? (
        <ColumnMenu
          open={menu !== null}
          x={menu?.x ?? 0}
          y={menu?.y ?? 0}
          columnId={columnId}
          name={name}
          type={type}
          settings={settings}
          index={index}
          columnCount={columnCount}
          direction={direction}
          canManage={canManage}
          canDelete={canDelete}
          canStyle={canStyle}
          onClose={closeMenu}
          onRename={() => onRenaming(columnId)}
          onCommit={onCommit}
          onOfferUndo={onOfferUndo}
        />
      ) : null}
    </div>
  );
}
