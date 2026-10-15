import {
  FILL_COLORS,
  type ColumnType,
  type DueTone,
  type FileAttachment,
  type StatusOption,
  type TimelineRange,
} from "@/lib/db-types";
import type { JsonValue } from "@/lib/sheets/ops";

export const PRIORITY_OPTIONS: readonly StatusOption[] = [
  { id: "critical", label: "Critical", color: "#333333" },
  { id: "high", label: "High", color: "#e2445c" },
  { id: "medium", label: "Medium", color: "#fdab3d" },
  { id: "low", label: "Low", color: "#579bfc" },
];

export const FILE_MAX_COUNT = 10;
export const TAG_MAX_COUNT = 20;
export const TAG_MAX_LENGTH = 40;

const DONE_LABELS = new Set(["done", "تم", "مكتمل", "complete", "completed"]);

export function carryColumnSettings(
  fromType: ColumnType,
  toType: ColumnType,
  current: unknown,
): Record<string, JsonValue> {
  const next = { ...defaultColumnSettings(toType) };
  if (
    (fromType === "status" || fromType === "dropdown") &&
    (toType === "status" || toType === "dropdown") &&
    current &&
    typeof current === "object" &&
    !Array.isArray(current) &&
    "options" in current
  ) {
    next.options = (current as { options: JsonValue }).options;
  }
  return next;
}

export function defaultColumnSettings(type: ColumnType): Record<string, JsonValue> {
  if (type === "person") {
    return { multiple: false };
  }
  if (type === "status" || type === "dropdown") {
    return { options: [] };
  }
  if (type === "priority") {
    return { options: PRIORITY_OPTIONS.map((option) => ({ ...option })) };
  }
  if (type === "due_date") {
    return { remind: false };
  }
  if (type === "timeline") {
    return { color: "#579bfc" };
  }
  return {};
}

export function tagColorFor(label: string): string {
  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) >>> 0;
  }
  return FILL_COLORS[hash % FILL_COLORS.length] ?? "#d0ebff";
}

export function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function isDoneLabel(label: string): boolean {
  return DONE_LABELS.has(label.trim().toLowerCase());
}

export function rowIsDone(
  data: Record<string, JsonValue | undefined>,
  columns: Array<{ id: string; type: ColumnType; settings?: unknown }>,
): boolean {
  for (const column of columns) {
    if (column.type !== "status") {
      continue;
    }
    const value = data[column.id];
    if (typeof value !== "string") {
      continue;
    }
    const options = readOptions(column.settings);
    const option = options.find((item) => item.id === value);
    if (option && isDoneLabel(option.label)) {
      return true;
    }
  }
  return false;
}

export function dueToneFor(iso: string | undefined, done: boolean, today = localToday()): DueTone {
  if (!iso || done) {
    return null;
  }
  if (iso < today) {
    return "overdue";
  }
  if (iso === today) {
    return "today";
  }
  return null;
}

export function asTimeline(value: unknown): TimelineRange | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const start = "start" in value && typeof value.start === "string" ? value.start : "";
  const end = "end" in value && typeof value.end === "string" ? value.end : "";
  if (!start || !end) {
    return undefined;
  }
  return { start, end };
}

export function asFileList(value: unknown): FileAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const files: FileAttachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const url =
      typeof record.url === "string"
        ? record.url
        : typeof record.key === "string" && /^https?:\/\//i.test(record.key)
          ? record.key
          : "";
    if (typeof record.id === "string" && typeof record.name === "string" && url) {
      files.push({
        id: record.id,
        name: record.name,
        url,
      });
    }
  }
  return files;
}

export function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function fileHref(file: FileAttachment): string {
  return file.url;
}

function readOptions(settings: unknown): StatusOption[] {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return [];
  }
  const options = (settings as { options?: unknown }).options;
  if (!Array.isArray(options)) {
    return [];
  }
  const parsed: StatusOption[] = [];
  for (const option of options) {
    if (!option || typeof option !== "object" || Array.isArray(option)) {
      continue;
    }
    const record = option as Record<string, unknown>;
    if (typeof record.id === "string" && typeof record.label === "string" && typeof record.color === "string") {
      parsed.push({ id: record.id, label: record.label, color: record.color });
    }
  }
  return parsed;
}
