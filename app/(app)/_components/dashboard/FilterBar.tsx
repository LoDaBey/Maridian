"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, Check, ChevronDown, Filter, Plus, Users, X } from "lucide-react";
import { getColumnValues } from "@/app/(app)/w/[workspaceId]/dashboards/actions";
import { DATE_RANGE_LABEL, DATE_RANGES, GROUPABLE_TYPES, refKey, type ColumnRef, type DateRange } from "@/lib/analytics/types";
import type { DashboardFilters } from "@/lib/analytics/widgets";
import type { DashboardSource } from "@/lib/dashboards/repo";

export interface Person {
  id: string;
  fullName: string;
  avatarColor: string;
}

function Popover({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) {
    return null;
  }
  return (
    <div ref={ref} className="absolute start-0 top-full z-40 mt-1 w-72 rounded-lg border border-border bg-surface p-2 text-sm shadow-xl">
      {children}
    </div>
  );
}

function chip(active: boolean): string {
  return `inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${
    active ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface text-text hover:bg-row"
  }`;
}

/** Dashboard-wide filters; every widget whose sheets have the column follows them. */
export function FilterBar({
  workspaceId,
  value,
  onChange,
  sources,
  people,
  canSaveDefault,
  onSaveDefault,
}: {
  workspaceId: string;
  value: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
  sources: DashboardSource[];
  people: Person[];
  canSaveDefault: boolean;
  onSaveDefault: () => void;
}) {
  const [open, setOpen] = useState<"date" | "people" | "add" | string | null>(null);
  const [peopleSearch, setPeopleSearch] = useState("");
  const [values, setValues] = useState<Record<string, Array<{ key: string; label: string; color?: string }>>>({});
  const allIds = useMemo(() => sources.map((source) => source.id), [sources]);
  const columns = useMemo(() => {
    const seen = new Set<string>();
    return sources
      .flatMap((source) => source.columns)
      .filter((column) => GROUPABLE_TYPES.has(column.type) && !["date", "due_date", "created_at", "updated_at", "timeline"].includes(column.type))
      .filter((column) => {
        const key = refKey({ ...column, name: column.name.trim().toLowerCase() });
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }, [sources]);
  const range = value.range ?? "all";
  const chosenPeople = value.people ?? [];
  const columnFilters = value.columns ?? [];
  const active = range !== "all" || chosenPeople.length > 0 || columnFilters.length > 0;

  async function loadValues(ref: ColumnRef) {
    const key = refKey(ref);
    if (values[key]) {
      return;
    }
    const list = await getColumnValues({ workspaceId, workbookIds: allIds, ref });
    setValues((current) => ({ ...current, [key]: list }));
  }

  const peopleShown = people.filter((person) => person.fullName.toLowerCase().includes(peopleSearch.trim().toLowerCase()));

  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Dashboard filters">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
        <Filter className="size-3.5" aria-hidden="true" />
        Filters
      </span>

      <div className="relative">
        <button type="button" className={chip(range !== "all")} aria-expanded={open === "date"} onClick={() => setOpen(open === "date" ? null : "date")}>
          <CalendarRange className="size-4" aria-hidden="true" />
          {range === "custom" && value.from && value.to ? `${value.from} → ${value.to}` : DATE_RANGE_LABEL[range]}
          <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
        </button>
        <Popover open={open === "date"} onClose={() => setOpen(null)}>
          <ul className="grid grid-cols-2 gap-1">
            {DATE_RANGES.filter((item) => item !== "custom").map((item) => (
              <li key={item}>
                <button
                  type="button"
                  className={`flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-start hover:bg-row ${range === item ? "font-medium text-primary" : ""}`}
                  onClick={() => {
                    onChange({ ...value, range: item, from: undefined, to: undefined });
                    setOpen(null);
                  }}
                >
                  {DATE_RANGE_LABEL[item]}
                  {range === item ? <Check className="size-3.5" aria-hidden="true" /> : null}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 border-t border-border pt-2">
            <p className="mb-1 text-xs text-muted">Custom range</p>
            <div className="flex items-center gap-1">
              <input
                type="date"
                aria-label="From"
                value={value.from ?? ""}
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 py-1 text-xs"
                onChange={(event) => onChange({ ...value, range: "custom", from: event.target.value || undefined })}
              />
              <span className="text-muted">→</span>
              <input
                type="date"
                aria-label="To"
                value={value.to ?? ""}
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 py-1 text-xs"
                onChange={(event) => onChange({ ...value, range: "custom", to: event.target.value || undefined })}
              />
            </div>
          </div>
        </Popover>
      </div>

      <div className="relative">
        <button type="button" className={chip(chosenPeople.length > 0)} aria-expanded={open === "people"} onClick={() => setOpen(open === "people" ? null : "people")}>
          <Users className="size-4" aria-hidden="true" />
          {chosenPeople.length === 0
            ? "Everyone"
            : chosenPeople.length === 1
              ? (people.find((person) => person.id === chosenPeople[0])?.fullName ?? "1 person")
              : `${chosenPeople.length} people`}
          <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
        </button>
        <Popover open={open === "people"} onClose={() => setOpen(null)}>
          <input
            autoFocus
            value={peopleSearch}
            placeholder="Search people"
            aria-label="Search people"
            className="mb-1 w-full rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-primary"
            onChange={(event) => setPeopleSearch(event.target.value)}
          />
          <ul className="max-h-60 overflow-auto">
            {peopleShown.map((person) => {
              const checked = chosenPeople.includes(person.id);
              return (
                <li key={person.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      aria-label={person.fullName}
                      className="size-4 accent-primary"
                      onChange={() =>
                        onChange({
                          ...value,
                          people: checked ? chosenPeople.filter((id) => id !== person.id) : [...chosenPeople, person.id],
                        })
                      }
                    />
                    <span
                      aria-hidden="true"
                      className="inline-flex size-6 items-center justify-center rounded-full text-[10px] font-medium text-white"
                      style={{ backgroundColor: person.avatarColor }}
                    >
                      {(person.fullName[0] ?? "?").toUpperCase()}
                    </span>
                    <span className="truncate">{person.fullName}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Popover>
      </div>

      {columnFilters.map((filter, index) => {
        const key = refKey(filter.ref);
        const options = values[key] ?? [];
        const id = `col-${index}`;
        return (
          <div key={key} className="relative">
            <span className={`${chip(filter.values.length > 0)} pe-1`}>
              <button
                type="button"
                className="max-w-56 cursor-pointer truncate"
                dir="auto"
                onClick={() => {
                  void loadValues(filter.ref);
                  setOpen(open === id ? null : id);
                }}
              >
                {filter.ref.name}:{" "}
                {filter.values.length === 0
                  ? "any"
                  : filter.values.length === 1
                    ? (options.find((option) => option.key === filter.values[0])?.label ?? filter.values[0])
                    : `${filter.values.length} selected`}
              </button>
              <button
                type="button"
                aria-label={`Remove ${filter.ref.name} filter`}
                className="cursor-pointer rounded-full p-1 hover:bg-row"
                onClick={() => onChange({ ...value, columns: columnFilters.filter((_, at) => at !== index) })}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
            <Popover open={open === id} onClose={() => setOpen(null)}>
              {options.length === 0 ? <p className="px-2 py-1.5 text-muted">Loading values…</p> : null}
              <ul className="max-h-64 overflow-auto">
                {options.map((option) => {
                  const checked = filter.values.includes(option.key);
                  return (
                    <li key={option.key}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-row">
                        <input
                          type="checkbox"
                          checked={checked}
                          aria-label={option.label}
                          className="size-4 accent-primary"
                          onChange={() => {
                            const next = checked ? filter.values.filter((item) => item !== option.key) : [...filter.values, option.key];
                            onChange({
                              ...value,
                              columns: columnFilters.map((item, at) => (at === index ? { ...item, values: next } : item)),
                            });
                          }}
                        />
                        {option.color ? <span aria-hidden="true" className="size-2.5 rounded-sm" style={{ backgroundColor: option.color }} /> : null}
                        <span dir="auto" className="truncate">
                          {option.label}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </Popover>
          </div>
        );
      })}

      {columnFilters.length < 5 && columns.length > 0 ? (
        <div className="relative">
          <button type="button" className={chip(false)} onClick={() => setOpen(open === "add" ? null : "add")}>
            <Plus className="size-4" aria-hidden="true" />
            Add filter
          </button>
          <Popover open={open === "add"} onClose={() => setOpen(null)}>
            <p className="px-2 pb-1 text-xs text-muted">Filter every widget by a column</p>
            <ul className="max-h-64 overflow-auto">
              {columns
                .filter((column) => !columnFilters.some((filter) => refKey(filter.ref) === refKey(column)))
                .map((column) => (
                  <li key={refKey(column)}>
                    <button
                      type="button"
                      dir="auto"
                      className="w-full cursor-pointer truncate rounded-md px-2 py-1.5 text-start hover:bg-row"
                      onClick={() => {
                        onChange({ ...value, columns: [...columnFilters, { ref: column, values: [] }] });
                        void loadValues(column);
                        setOpen(`col-${columnFilters.length}`);
                      }}
                    >
                      {column.name}
                    </button>
                  </li>
                ))}
            </ul>
          </Popover>
        </div>
      ) : null}

      {active ? (
        <button type="button" className="cursor-pointer px-2 text-sm text-muted hover:text-text" onClick={() => onChange({})}>
          Clear
        </button>
      ) : null}
      {canSaveDefault ? (
        <button type="button" className="cursor-pointer px-2 text-sm text-primary hover:underline" onClick={onSaveDefault}>
          Save as default
        </button>
      ) : null}
    </div>
  );
}

export type { DateRange };
