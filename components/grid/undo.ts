import type { HistoryEntry } from "./types";

const LIMIT = 100;

const stacks = new Map<string, { undo: HistoryEntry[]; redo: HistoryEntry[] }>();

function stackFor(sheetId: string): { undo: HistoryEntry[]; redo: HistoryEntry[] } {
  const existing = stacks.get(sheetId);
  if (existing) {
    return existing;
  }
  const created = { undo: [], redo: [] };
  stacks.set(sheetId, created);
  return created;
}

export function pushHistory(sheetId: string, entry: HistoryEntry): void {
  const stack = stackFor(sheetId);
  stack.undo.push(entry);
  if (stack.undo.length > LIMIT) {
    stack.undo.shift();
  }
  stack.redo.length = 0;
}

export function undoEntry(sheetId: string): HistoryEntry | null {
  const entry = stackFor(sheetId).undo.pop() ?? null;
  if (entry) {
    stackFor(sheetId).redo.push(entry);
  }
  return entry;
}

export function redoEntry(sheetId: string): HistoryEntry | null {
  const entry = stackFor(sheetId).redo.pop() ?? null;
  if (entry) {
    stackFor(sheetId).undo.push(entry);
  }
  return entry;
}

export function clearHistory(sheetId: string): void {
  stacks.delete(sheetId);
}
