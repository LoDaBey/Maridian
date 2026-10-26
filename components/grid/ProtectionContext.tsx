"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSocket } from "@/lib/realtime/client";
import type { Protection } from "@/lib/sheets/workbook-access";
import { useGroups, useSheetStore } from "@/stores/sheet-store";
import type { LocalRow } from "@/lib/sheets/apply-local";

export interface ProtectionState {
  /** The whole tab is read-only for me. */
  tabLocked: boolean;
  lockedColumns: ReadonlySet<string>;
  lockedGroups: ReadonlySet<string>;
  /** I'm the sheet owner or a workspace admin: I see and manage every lock. */
  canManage: boolean;
  protections: Protection[];
  /** "Assigned only" members: whose items they may edit (null = no such limit). */
  assignees: ReadonlySet<string> | null;
  refresh: () => void;
}

const EMPTY: ProtectionState = {
  tabLocked: false,
  lockedColumns: new Set(),
  lockedGroups: new Set(),
  canManage: false,
  protections: [],
  assignees: null,
  refresh: () => {},
};

const Context = createContext<ProtectionState>(EMPTY);

interface Reply {
  ok: boolean;
  locks?: { tab: boolean; columns: string[]; groups: string[] };
  canManage?: boolean;
  protections?: Protection[];
  assignees?: string[] | null;
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
      assignees: reply?.assignees ? new Set(reply.assignees) : null,
      refresh,
    }),
    [reply, refresh],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useProtection(): ProtectionState {
  return useContext(Context);
}

/**
 * True when this person may not edit this cell: a locked column, a row in a locked group,
 * or (for "assigned only" members) a row that isn't theirs or their team's.
 */
export function useCellLocked(columnId: string, row: Pick<LocalRow, "groupId" | "createdBy" | "data"> | undefined): boolean {
  const protection = useProtection();
  const groups = useGroups();
  const store = useSheetStore();
  if (protection.tabLocked || protection.lockedColumns.has(columnId)) {
    return true;
  }
  const group = row?.groupId ?? groups[0]?.id;
  if (group !== undefined && protection.lockedGroups.has(group)) {
    return true;
  }
  const people = protection.assignees;
  if (!people || !row) {
    return false;
  }
  if (row.createdBy && people.has(row.createdBy)) {
    return false;
  }
  // Read columns without subscribing every cell to column changes; the row re-renders this.
  return !Object.values(store.getState().columns).some((column) => {
    const value = column.type === "person" ? row.data[column.id] : undefined;
    return Array.isArray(value) && value.some((id) => typeof id === "string" && people.has(id));
  });
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
