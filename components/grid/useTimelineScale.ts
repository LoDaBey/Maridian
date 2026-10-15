"use client";

import { useMemo } from "react";
import { useStore } from "zustand";
import type { TimelineScale } from "@/lib/db-types";
import { asTimeline } from "@/lib/sheets/column-meta";
import { timelineScaleFor } from "@/lib/sheets/timeline";
import { useSheetStore } from "@/stores/sheet-store";

export function useTimelineScale(columnId: string): TimelineScale | null {
  const store = useSheetStore();
  const key = useStore(store, (state) => {
    const ranges = state.rowOrder.flatMap((rowId) => {
      const range = asTimeline(state.rows[rowId]?.data[columnId]);
      return range ? [`${range.start}:${range.end}`] : [];
    });
    return ranges.join("|");
  });
  return useMemo(() => {
    if (!key) {
      return null;
    }
    const ranges = key.split("|").map((part) => {
      const [start, end] = part.split(":");
      return { start: start ?? "", end: end ?? "" };
    });
    return timelineScaleFor(ranges);
  }, [key]);
}
