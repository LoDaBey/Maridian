import type { TimelineBarRect, TimelineRange, TimelineScale } from "@/lib/db-types";

const DAY_MS = 86_400_000;

export function timelineScaleFor(ranges: readonly TimelineRange[]): TimelineScale | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const range of ranges) {
    const start = Date.parse(`${range.start}T00:00:00`);
    const end = Date.parse(`${range.end}T00:00:00`);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      continue;
    }
    min = Math.min(min, start);
    max = Math.max(max, end);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  const span = Math.max(max - min, DAY_MS);
  const pad = Math.max(span * 0.08, DAY_MS);
  return { startMs: min - pad, endMs: max + pad };
}

export function timelineBarRect(range: TimelineRange, scale: TimelineScale): TimelineBarRect {
  const start = Date.parse(`${range.start}T00:00:00`);
  const end = Date.parse(`${range.end}T00:00:00`);
  const span = scale.endMs - scale.startMs;
  if (!Number.isFinite(start) || !Number.isFinite(end) || span <= 0) {
    return { startPct: 4, widthPct: 92 };
  }
  const startPct = ((start - scale.startMs) / span) * 100;
  const endPct = ((end + DAY_MS - scale.startMs) / span) * 100;
  const widthPct = Math.max(10, endPct - startPct);
  return {
    startPct: Math.min(90, Math.max(0, startPct)),
    widthPct: Math.min(100 - Math.min(90, Math.max(0, startPct)), widthPct),
  };
}

export function formatTimelineLabel(range: TimelineRange): string {
  if (range.start === range.end) {
    return formatTimelineDate(range.start);
  }
  return `${formatTimelineDate(range.start)} – ${formatTimelineDate(range.end)}`;
}

export function formatTimelineDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return iso;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
