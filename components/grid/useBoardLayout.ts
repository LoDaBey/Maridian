"use client";

import { useSyncExternalStore } from "react";
import type { BoardLayout } from "./types";

const listeners = new Set<() => void>();
const cache = new Map<string, BoardLayout>();

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

function read(sheetId: string): BoardLayout {
  const cached = cache.get(sheetId);
  if (cached) {
    return cached;
  }
  if (typeof window === "undefined") {
    return "table";
  }
  const stored = window.localStorage.getItem(`monitor:layout:${sheetId}`);
  const layout: BoardLayout = stored === "kanban" || stored === "timeline" ? stored : "table";
  cache.set(sheetId, layout);
  return layout;
}

export function useBoardLayout(sheetId: string): {
  layout: BoardLayout;
  setLayout: (next: BoardLayout) => void;
} {
  const layout = useSyncExternalStore(
    subscribe,
    () => read(sheetId),
    () => "table" as const,
  );

  function setLayout(next: BoardLayout): void {
    cache.set(sheetId, next);
    window.localStorage.setItem(`monitor:layout:${sheetId}`, next);
    emit();
  }

  return { layout, setLayout };
}
