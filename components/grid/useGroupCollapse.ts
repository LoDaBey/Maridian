"use client";

import { useMemo, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const cache = new Map<string, Record<string, boolean>>();

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

function keyFor(sheetId: string): string {
  return `monitor:groups:${sheetId}`;
}

function read(sheetId: string): Record<string, boolean> {
  const cached = cache.get(sheetId);
  if (cached) {
    return cached;
  }
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(keyFor(sheetId));
    const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    cache.set(sheetId, parsed);
    return parsed;
  } catch {
    cache.set(sheetId, {});
    return {};
  }
}

function write(sheetId: string, next: Record<string, boolean>): void {
  cache.set(sheetId, next);
  try {
    window.localStorage.setItem(keyFor(sheetId), JSON.stringify(next));
  } catch {
    // Ignore quota errors.
  }
  emit();
}

export function useGroupCollapse(sheetId: string): {
  collapsed: Record<string, boolean>;
  isCollapsed: (groupId: string) => boolean;
  toggle: (groupId: string) => void;
} {
  const collapsed = useSyncExternalStore(subscribe, () => read(sheetId), (): Record<string, boolean> => ({}));
  return useMemo(
    () => ({
      collapsed,
      isCollapsed: (groupId: string) => collapsed[groupId] === true,
      toggle: (groupId: string) => {
        const current = read(sheetId);
        write(sheetId, { ...current, [groupId]: !current[groupId] });
      },
    }),
    [collapsed, sheetId],
  );
}
