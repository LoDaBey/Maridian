"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  EMPTY_VIEW,
  VIEW_STORAGE_PREFIX,
  isTransformedView,
  type FilterRule,
  type SheetView,
  type SortRule,
} from "@/lib/sheets/view";

const listeners = new Set<() => void>();
const cache = new Map<string, SheetView>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(sheetId: string): SheetView {
  const cached = cache.get(sheetId);
  if (cached) {
    return cached;
  }
  const loaded = readView(sheetId);
  cache.set(sheetId, loaded);
  return loaded;
}

function update(sheetId: string, partial: Partial<SheetView>): void {
  const next = { ...getSnapshot(sheetId), ...partial };
  cache.set(sheetId, next);
  persist(sheetId, next);
  emit();
}

export function useViewState(sheetId: string): SheetView & {
  isTransformed: boolean;
  setSearch: (search: string) => void;
  setFilters: (filters: FilterRule[]) => void;
  setSort: (sort: SortRule | null) => void;
  setMine: (mine: boolean) => void;
  setToday: (today: boolean) => void;
  setFilterActive: (filterActive: boolean) => void;
  clear: () => void;
  /** Replace the whole view (a saved view being applied). */
  apply: (view: Partial<SheetView>) => void;
} {
  const view = useSyncExternalStore(subscribe, () => getSnapshot(sheetId), () => EMPTY_VIEW);
  const actions = useMemo(
    () => ({
      setSearch: (search: string) => update(sheetId, { search }),
      setFilters: (filters: FilterRule[]) => update(sheetId, { filters }),
      setSort: (sort: SortRule | null) => update(sheetId, { sort }),
      setMine: (mine: boolean) => update(sheetId, { mine }),
      setToday: (today: boolean) => update(sheetId, { today }),
      setFilterActive: (filterActive: boolean) => {
        if (filterActive) {
          update(sheetId, { filterActive: true });
          return;
        }
        const current = getSnapshot(sheetId);
        update(sheetId, {
          filterActive: false,
          filters: current.filters.filter((rule) => rule.operator !== "in_values"),
        });
      },
      clear: () => update(sheetId, EMPTY_VIEW),
      apply: (view: Partial<SheetView>) => update(sheetId, { ...EMPTY_VIEW, ...view }),
    }),
    [sheetId],
  );

  return {
    ...view,
    ...actions,
    isTransformed: isTransformedView(view),
  };
}

function readView(sheetId: string): SheetView {
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_PREFIX + sheetId);
    if (!raw) {
      return EMPTY_VIEW;
    }
    const parsed = JSON.parse(raw) as Partial<SheetView>;
    return {
      search: typeof parsed.search === "string" ? parsed.search : "",
      filters: Array.isArray(parsed.filters) ? parsed.filters.filter(isFilterRule) : [],
      sort: isSort(parsed.sort) ? parsed.sort : null,
      mine: parsed.mine === true,
      today: parsed.today === true,
      filterActive: parsed.filterActive === true || (Array.isArray(parsed.filters) && parsed.filters.some(isValueFilter)),
    };
  } catch {
    return EMPTY_VIEW;
  }
}

function persist(sheetId: string, view: SheetView): void {
  try {
    localStorage.setItem(VIEW_STORAGE_PREFIX + sheetId, JSON.stringify(view));
  } catch {
    // The view still works for this visit when storage is unavailable.
  }
}

function isFilterRule(value: unknown): value is FilterRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const rule = value as FilterRule;
  return typeof rule.id === "string" && typeof rule.columnId === "string" && typeof rule.operator === "string";
}

function isValueFilter(value: unknown): boolean {
  return isFilterRule(value) && value.operator === "in_values";
}

function isSort(value: unknown): value is SortRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const sort = value as SortRule;
  return typeof sort.columnId === "string" && (sort.direction === "asc" || sort.direction === "desc");
}
