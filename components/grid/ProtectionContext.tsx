"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSocket } from "@/lib/realtime/client";
import type { Protection } from "@/lib/sheets/workbook-access";
import { useGroups } from "@/stores/sheet-store";

export interface ProtectionState {
  /** The whole tab is read-only for me. */
  tabLocked: boolean;
  lockedColumns: ReadonlySet<string>;
  lockedGroups: ReadonlySet<string>;
  /** I'm the sheet owner or a workspace admin: I see and manage every lock. */
  canManage: boolean;
  protections: Protection[];
  refresh: () => void;
}

const EMPTY: ProtectionState = {
  tabLocked: false,
  lockedColumns: new Set(),
  lockedGroups: new Set(),
  canManage: false,
  protections: [],
  refresh: () => {},
};

const Context = createContext<ProtectionState>(EMPTY);

interface Reply {
  ok: boolean;
  locks?: { tab: boolean; columns: string[]; groups: string[] };
  canManage?: boolean;
  protections?: Protection[];
}

export function ProtectionProvider({ sheetId, children }: { sheetId: string; children: ReactNode }) {
  const [reply, setReply] = useState<Reply | null>(null);

  const refresh = useCallback(() => {
    getSocket()
      .timeout(10_000)
      .emit("sheet:protection", { sheetId }, (error: Error | null, result?: Reply) => {
        if (!error && result?.ok) {
          setReply(result);
        }
      });
  }, [sheetId]);

  useEffect(() => {
    const socket = getSocket();
    const onChanged = (payload: { sheetId?: string }) => {
      if (payload?.sheetId === sheetId) {
        refresh();
      }
    };
    refresh();
    socket.on("sheet:protection-changed", onChanged);
    socket.on("connect", refresh);
    return () => {
      socket.off("sheet:protection-changed", onChanged);
      socket.off("connect", refresh);
    };
  }, [sheetId, refresh]);

  const value = useMemo<ProtectionState>(
    () => ({
      tabLocked: reply?.locks?.tab ?? false,
      lockedColumns: new Set(reply?.locks?.columns ?? []),
      lockedGroups: new Set(reply?.locks?.groups ?? []),
      canManage: reply?.canManage ?? false,
      protections: reply?.protections ?? [],
      refresh,
    }),
    [reply, refresh],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useProtection(): ProtectionState {
  return useContext(Context);
}

/** True when this person may not edit this cell (locked column, or a row in a locked group). */
export function useCellLocked(columnId: string, groupId: string | null | undefined): boolean {
  const protection = useProtection();
  const groups = useGroups();
  if (protection.tabLocked || protection.lockedColumns.has(columnId)) {
    return true;
  }
  const group = groupId ?? groups[0]?.id;
  return group !== undefined && protection.lockedGroups.has(group);
}

/** For managers: is anything on this target protected (shows a lock icon even though they can edit). */
export function useIsProtected(scope: Protection["scope"], targetId: string | null): boolean {
  const protection = useProtection();
  if (scope === "column" && targetId && protection.lockedColumns.has(targetId)) {
    return true;
  }
  if (scope === "group" && targetId && protection.lockedGroups.has(targetId)) {
    return true;
  }
  if (scope === "tab" && protection.tabLocked) {
    return true;
  }
  return protection.protections.some((item) => item.scope === scope && item.targetId === targetId);
}
