"use client";

import { ChevronDown } from "lucide-react";
import { ActionButton } from "./ActionButton";
import type { LocalColumn, LocalGroup, LocalRow } from "@/lib/sheets/apply-local";
import { localToday } from "@/lib/sheets/column-meta";
import type { SheetOp } from "@/lib/sheets/ops";
import { TimelineItemBar } from "./TimelineItemBar";
import {
  dayIndex,
  itemSchedule,
  itemTitle,
  shiftIso,
  timelineMonths,
  timelineWindow,
} from "./board-views";
import type { ItemSchedule } from "./types";

const LABEL_WIDTH = 240;

export function TimelineView({
  groups,
  rowsByGroup,
  rows,
  columns,
  nameColumnId,
  readOnly,
  isCollapsed,
  onToggleGroup,
  onOpenItem,
  onCommit,
}: {
  groups: LocalGroup[];
  rowsByGroup: Map<string, string[]>;
  rows: Record<string, LocalRow>;
  columns: LocalColumn[];
  nameColumnId: string | undefined;
  readOnly: boolean;
  isCollapsed: (groupId: string) => boolean;
  onToggleGroup: (groupId: string) => void;
  onOpenItem?: (rowId: string) => void;
  onCommit: (type: SheetOp["type"], payload: SheetOp["payload"]) => void;
}) {
  const schedules = new Map<string, ItemSchedule | null>();
  const ranges: Array<{ start: string; end: string }> = [];
  for (const group of groups) {
    for (const rowId of rowsByGroup.get(group.id) ?? []) {
      const schedule = itemSchedule(rows[rowId], columns);
      schedules.set(rowId, schedule);
      if (schedule) {
        ranges.push(schedule.range);
      }
    }
  }
  const scale = timelineWindow(ranges);
  const months = timelineMonths(scale);
  const todayIndex = dayIndex(localToday(), scale);
  const showToday = todayIndex >= 0 && todayIndex <= scale.totalDays;

  function moveSchedule(rowId: string, schedule: ItemSchedule, days: number): void {
    if (readOnly) {
      return;
    }
    if (schedule.kind === "date") {
      onCommit("cell.set", { rowId, columnId: schedule.columnId, value: shiftIso(schedule.range.start, days) });
      return;
    }
    onCommit("cell.set", {
      rowId,
      columnId: schedule.columnId,
      value: { start: shiftIso(schedule.range.start, days), end: shiftIso(schedule.range.end, days) },
    });
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-surface" dir="ltr">
      <div className="relative min-h-full" style={{ width: LABEL_WIDTH + scale.chartWidth }}>
        <div className="sticky top-0 z-20 flex border-b border-border bg-surface">
          <div className="sticky start-0 z-30 shrink-0 border-e border-border bg-surface" style={{ width: LABEL_WIDTH }} />
          <div className="relative h-10" style={{ width: scale.chartWidth }}>
            {months.map((month) => (
              <div
                key={`${month.label}-${month.offset}`}
                className="absolute top-0 flex h-10 items-center border-s border-border px-2 text-xs text-muted"
                style={{ left: month.offset, width: month.width }}
              >
                {month.label}
              </div>
            ))}
          </div>
        </div>
        {showToday ? (
          <span
            className="pointer-events-none absolute bottom-0 top-10 z-10 w-px bg-primary"
            style={{ left: LABEL_WIDTH + todayIndex * scale.pxPerDay }}
          />
        ) : null}
        {groups.map((group) => {
          const rowIds = rowsByGroup.get(group.id) ?? [];
          const collapsed = isCollapsed(group.id);
          return (
            <section key={group.id}>
              <div className="flex h-10 items-center">
                <ActionButton
                  aria-label={collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
                  aria-expanded={!collapsed}
                  className="sticky start-0 z-10 flex h-10 cursor-pointer items-center gap-1 rounded-lg bg-surface px-3 text-start text-sm font-medium"
                  style={{ width: LABEL_WIDTH, color: group.color }}
                  onClick={() => onToggleGroup(group.id)}
                >
                  <ChevronDown className={`size-4 ${collapsed ? "-rotate-90" : ""}`} aria-hidden="true" />
                  <span className="truncate">{group.name}</span>
                  <span className="text-xs text-muted">{rowIds.length}</span>
                </ActionButton>
              </div>
              {collapsed
                ? null
                : rowIds.map((rowId) => {
                    const schedule = schedules.get(rowId) ?? null;
                    const title = itemTitle(rows[rowId], nameColumnId);
                    const left = schedule ? dayIndex(schedule.range.start, scale) * scale.pxPerDay : 0;
                    const span = schedule ? dayIndex(schedule.range.end, scale) - dayIndex(schedule.range.start, scale) + 1 : 1;
                    const width = Math.max(96, span * scale.pxPerDay);
                    return (
                      <div key={rowId} className="flex h-11 items-center border-b border-border">
                        <ActionButton
                          aria-label={`Open ${title}`}
                          className="sticky start-0 z-10 flex h-11 cursor-pointer items-center gap-2 truncate rounded-lg bg-surface px-4 text-start text-sm text-text hover:text-primary"
                          style={{ width: LABEL_WIDTH }}
                          onClick={() => onOpenItem?.(rowId)}
                        >
                          <span className="h-6 w-1 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
                          <span className="truncate">{title}</span>
                        </ActionButton>
                        <div className="relative h-11" style={{ width: scale.chartWidth }}>
                          {schedule ? (
                            <TimelineItemBar
                              range={schedule.range}
                              left={left}
                              width={Math.min(width, scale.chartWidth - left)}
                              color={group.color}
                              pxPerDay={scale.pxPerDay}
                              readOnly={readOnly}
                              onMove={(days) => moveSchedule(rowId, schedule, days)}
                            />
                          ) : (
                            <span className="absolute top-3 text-xs text-muted" style={{ left: 8 }}>
                              No date
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
