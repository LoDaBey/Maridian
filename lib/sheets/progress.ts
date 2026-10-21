import { labeledOptions } from "@/lib/sheets/values";
import type { ColumnType } from "@/lib/db-types";

/** Monday's "Done" greens. A label in one of these colours counts as finished. */
const DONE_COLORS = new Set(["#00c875", "#037f4c"]);
const DONE_WORDS = new Set(["done", "complete", "completed", "finished", "تم", "مكتمل", "منتهي", "انتهى", "منجز"]);

function isDoneLabel(label: string, color: string): boolean {
  return DONE_COLORS.has(color.toLowerCase()) || DONE_WORDS.has(label.trim().toLowerCase());
}

export interface Progress {
  done: number;
  total: number;
  percent: number;
}

/**
 * A row's progress across its status columns (Monday's Progress column).
 * Only status columns that have a "done" label count, so a "Type" status with no
 * finished state doesn't drag the number down.
 */
export function rowProgress(
  data: Record<string, unknown>,
  columns: Array<{ id: string; type: ColumnType; settings: unknown; deleted?: boolean }>,
): Progress | null {
  let done = 0;
  let total = 0;
  for (const column of columns) {
    if (column.deleted || column.type !== "status") {
      continue;
    }
    const options = labeledOptions(column.settings);
    const doneIds = new Set(options.filter((option) => isDoneLabel(option.label, option.color)).map((option) => option.id));
    if (doneIds.size === 0) {
      continue;
    }
    total += 1;
    const value = data[column.id];
    if (typeof value === "string" && doneIds.has(value)) {
      done += 1;
    }
  }
  if (total === 0) {
    return null;
  }
  return { done, total, percent: Math.round((done / total) * 100) };
}
