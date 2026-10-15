"use client";

import { useSyncExternalStore } from "react";
import type { DirectoryResponse, DirectoryUser } from "./types";

let cached: DirectoryResponse | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function load(): Promise<void> {
  if (pending) {
    return pending;
  }

  pending = fetch("/api/users/directory", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error("directory");
      }
      cached = (await response.json()) as DirectoryResponse;
    })
    .catch(() => {
      pending = null;
    })
    .finally(() => {
      if (cached) {
        pending = null;
        notify();
      }
    });

  return pending;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!cached && !pending) {
    void load();
  }
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): DirectoryResponse | null {
  return cached;
}

function serverSnapshot(): null {
  return null;
}

const EMPTY_USERS: DirectoryUser[] = [];

export function refreshDirectory(): void {
  pending = null;
  void load();
}

export function useDirectory(): { users: DirectoryUser[]; ready: boolean } {
  const data = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return {
    users: data?.users ?? EMPTY_USERS,
    ready: data !== null,
  };
}
