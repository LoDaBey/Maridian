import type { LocalColumn, LocalRow } from "@/lib/sheets/apply-local";
import { asTimeline, asStringList } from "@/lib/sheets/column-meta";
import { displayValue, labeledOptions } from "@/lib/sheets/values";
import type { CardDetail, KanbanLane, ItemSchedule } from "./types";

const DAY_MS = 86_400_000;

export function groupingColumns(columns: LocalColumn[]): LocalColumn[] {
  return columns.filter((column) => column.type === "status" || column.type === "priority" || column.type === "dropdown");
}

export function visibleRowIds(groups: Array<{ id: string }>, rowsByGroup: Map<string, string[]>): string[] {
  return groups.flatMap((group) => rowsByGroup.get(group.id) ?? []);
}

export function lanesForColumn(
  column: LocalColumn,
  rowIds: string[],
  rows: Record<string, LocalRow>,
): KanbanLane[] {
  const options = labeledOptions(column.settings);
  const buckets = new Map<string, string[]>(options.map((option) => [option.id, []]));
  const blank: string[] = [];
  for (const rowId of rowIds) {
    const value = rows[rowId]?.data[column.id];
    const id = typeof value === "string" ? value : "";
    const bucket = buckets.get(id);
    if (bucket) {
      bucket.push(rowId);
    } else {
      blank.push(rowId);
    }
  }
  const lanes: KanbanLane[] = options.map((option) => ({
    id: option.id,
    label: option.label,
    color: option.color,
    rowIds: buckets.get(option.id) ?? [],
  }));
  if (blank.length > 0) {
    lanes.push({ id: "", label: "No status", color: "#c5c7d0", rowIds: blank });
  }
  return lanes;
}

export function lanesForGroups(
  groups: Array<{ id: string; name: string; color: string }>,
  rowsByGroup: Map<string, string[]>,
): KanbanLane[] {
  return groups.map((group) => ({
    id: group.id,
    label: group.name,
    color: group.color,
    rowIds: rowsByGroup.get(group.id) ?? [],
  }));
}

export function itemTitle(row: LocalRow | undefined, nameColumnId: string | undefined): string {
  const value = nameColumnId ? row?.data[nameColumnId] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : "Untitled";
}

export function firstColumn(columns: LocalColumn[], type: LocalColumn["type"]): LocalColumn | undefined {
  return columns.find((column) => column.type === type);
}

export function personIds(row: LocalRow | undefined, column: LocalColumn | undefined): string[] {
  if (!row || !column) {
    return [];
  }
  return asStringList(row.data[column.id]);
}

export function tagLabels(row: LocalRow | undefined, column: LocalColumn | undefined): string[] {
  if (!row || !column) {
    return [];
  }
  return asStringList(row.data[column.id]);
}

const DETAIL_SKIP = new Set(["person", "tags", "date", "due_date"]);

export function cardDetails(
  row: LocalRow | undefined,
  columns: LocalColumn[],
  skipIds: ReadonlySet<string>,
  namesById: ReadonlyMap<string, string>,
): CardDetail[] {
  if (!row) {
    return [];
  }
  const details: CardDetail[] = [];
  for (const column of columns) {
    if (skipIds.has(column.id) || DETAIL_SKIP.has(column.type)) {
      continue;
    }
    const text = displayValue(column, row.data[column.id], namesById).replace(/\s+/g, " ").trim();
    if (!text || text === "false") {
      continue;
    }
    details.push({ id: column.id, label: column.name, text });
    if (details.length === 4) {
      break;
    }
  }
  return details;
}

export function itemDateLabel(row: LocalRow | undefined, columns: LocalColumn[]): string {
  if (!row) {
    return "";
  }
  const due = firstColumn(columns, "due_date") ?? firstColumn(columns, "date");
  const value = due ? row.data[due.id] : undefined;
  return typeof value === "string" ? formatShortDate(value) : "";
}

export function itemSchedule(row: LocalRow | undefined, columns: LocalColumn[]): ItemSchedule | null {
  if (!row) {
    return null;
  }
  const timeline = firstColumn(columns, "timeline");
  if (timeline) {
    const range = asTimeline(row.data[timeline.id]);
    if (range) {
      return { columnId: timeline.id, kind: "timeline", range };
    }
  }
  const dateColumn = firstColumn(columns, "date") ?? firstColumn(columns, "due_date");
  const value = dateColumn ? row.data[dateColumn.id] : undefined;
  if (dateColumn && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { columnId: dateColumn.id, kind: "date", range: { start: value, end: value } };
  }
  return null;
}

export function shiftIso(iso: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return iso;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function parseIso(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return Number.NaN;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
}

export interface TimelineWindow {
  startMs: number;
  endMs: number;
  pxPerDay: number;
  totalDays: number;
  chartWidth: number;
}

export function timelineWindow(ranges: Array<{ start: string; end: string }>): TimelineWindow {
  const today = startOfDay(new Date());
  let min = today;
  let max = today + 27 * DAY_MS;
  for (const range of ranges) {
    const start = parseIso(range.start);
    const end = parseIso(range.end);
    if (Number.isFinite(start)) {
      min = Math.min(min, start);
    }
    if (Number.isFinite(end)) {
      max = Math.max(max, end);
    }
  }
  const startDate = new Date(min);
  startDate.setDate(1);
  const endDate = new Date(max);
  endDate.setMonth(endDate.getMonth() + 1, 0);
  const startMs = startOfDay(startDate);
  const endMs = startOfDay(endDate);
  const totalDays = Math.max(1, Math.round((endMs - startMs) / DAY_MS) + 1);
  const pxPerDay = totalDays > 400 ? 8 : totalDays > 180 ? 16 : totalDays > 70 ? 24 : 36;
  return { startMs, endMs, pxPerDay, totalDays, chartWidth: Math.max(720, totalDays * pxPerDay) };
}

export function dayIndex(iso: string, window: TimelineWindow): number {
  const time = parseIso(iso);
  if (!Number.isFinite(time)) {
    return 0;
  }
  return Math.round((time - window.startMs) / DAY_MS);
}

export interface TimelineMonth {
  label: string;
  offset: number;
  width: number;
}

export function timelineMonths(window: TimelineWindow): TimelineMonth[] {
  const months: TimelineMonth[] = [];
  const cursor = new Date(window.startMs);
  while (cursor.getTime() <= window.endMs) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const start = new Date(year, month, 1).getTime();
    const end = new Date(year, month + 1, 0).getTime();
    const from = Math.max(start, window.startMs);
    const to = Math.min(end, window.endMs);
    const days = Math.round((to - from) / DAY_MS) + 1;
    months.push({
      label: cursor.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      offset: Math.round((from - window.startMs) / DAY_MS) * window.pxPerDay,
      width: days * window.pxPerDay,
    });
    cursor.setMonth(month + 1, 1);
  }
  return months;
}

export function formatShortDate(iso: string): string {
  const time = parseIso(iso);
  if (!Number.isFinite(time)) {
    return iso;
  }
  return new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
