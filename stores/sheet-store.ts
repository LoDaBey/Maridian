"use client";

import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { SheetDirection } from "@/lib/db-types";
import type { JsonValue, SheetOp } from "@/lib/sheets/ops";
import type { ClientOp, LocalColumn, LocalGroup, LocalRow } from "@/lib/sheets/apply-local";

export type SyncStatus = "connecting" | "saved" | "saving" | "offline" | "error";

export interface PendingOp {
  op: SheetOp;
  inverse: ClientOp;
  sentAt: number;
  attempts: number;
}

export interface SheetState {
  sheet: { id: string; name: string; direction: SheetDirection };
  version: number;
  columns: Record<string, LocalColumn>;
  columnOrder: string[];
  rows: Record<string, LocalRow>;
  rowOrder: string[];
  groups: Record<string, LocalGroup>;
  groupOrder: string[];
  pending: Map<string, PendingOp>;
  status: SyncStatus;
  lastSavedAt?: number;
  lastError?: string;
  archived: boolean;
}

export const SheetStoreContext = createContext<StoreApi<SheetState> | null>(null);

export function createSheetStore(sheetId: string): StoreApi<SheetState> {
  return createStore<SheetState>()(() => ({
    sheet: { id: sheetId, name: "", direction: "rtl" },
    version: 0,
    columns: {},
    columnOrder: [],
    rows: {},
    rowOrder: [],
    groups: {},
    groupOrder: [],
    pending: new Map(),
    status: "connecting",
    archived: false,
  }));
}

export function useSheetStore(): StoreApi<SheetState> {
  const store = useContext(SheetStoreContext);
  if (!store) {
    throw new Error("Sheet store is unavailable.");
  }
  return store;
}

export function useCell(rowId: string, columnId: string): JsonValue | undefined {
  const store = useSheetStore();
  return useStore(store, (state) => state.rows[rowId]?.data[columnId]);
}

export function useRowIds(): string[] {
  const store = useSheetStore();
  return useStore(store, (state) => state.rowOrder);
}

export function useColumn(id: string): LocalColumn | undefined {
  const store = useSheetStore();
  return useStore(store, (state) => state.columns[id]);
}

export function useColumns(): LocalColumn[] {
  const store = useSheetStore();
  return useStore(
    store,
    useShallow((state) => state.columnOrder.map((id) => state.columns[id]).filter((column) => column !== undefined)),
  );
}

export function useRow(rowId: string): LocalRow | undefined {
  const store = useSheetStore();
  return useStore(store, (state) => state.rows[rowId]);
}

export function useGroups(): LocalGroup[] {
  const store = useSheetStore();
  return useStore(
    store,
    useShallow((state) => state.groupOrder.map((id) => state.groups[id]).filter((group) => group !== undefined)),
  );
}
