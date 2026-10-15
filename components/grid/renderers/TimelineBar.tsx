"use client";

import type { LocalColumn } from "@/lib/sheets/apply-local";
import type { JsonValue } from "@/lib/sheets/ops";
import { asTimeline } from "@/lib/sheets/column-meta";
import { formatTimelineLabel, timelineBarRect } from "@/lib/sheets/timeline";
import { useTimelineScale } from "../useTimelineScale";

export function TimelineBar({
  column,
  value,
}: {
  column: LocalColumn;
  value: JsonValue | undefined;
}) {
  const range = asTimeline(value);
  const scale = useTimelineScale(column.id);
  if (!range) {
    return null;
  }
  const color = typeof column.settings.color === "string" ? column.settings.color : "#579bfc";
  const label = formatTimelineLabel(range);
  const rect = scale ? timelineBarRect(range, scale) : { startPct: 0, widthPct: 42 };
  const showLabel = rect.widthPct >= 28;

  return (
    <span className="absolute inset-x-2 inset-y-1.5 flex items-center" title={label}>
      <span className="absolute inset-x-0 h-6 rounded-full bg-track" aria-hidden="true" />
      <span
        className="absolute flex h-6 items-center justify-center overflow-hidden rounded-full px-2 text-[11px] font-medium text-white"
        style={{
          backgroundColor: color,
          insetInlineStart: `${rect.startPct}%`,
          width: `${rect.widthPct}%`,
        }}
      >
        {showLabel ? <span className="truncate">{label}</span> : null}
      </span>
    </span>
  );
}
