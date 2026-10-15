"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { TimelineRange } from "@/lib/db-types";
import { formatShortDate } from "./board-views";

export function TimelineItemBar({
  range,
  left,
  width,
  color,
  pxPerDay,
  readOnly,
  onMove,
}: {
  range: TimelineRange;
  left: number;
  width: number;
  color: string;
  pxPerDay: number;
  readOnly: boolean;
  onMove: (days: number) => void;
}) {
  const [offsetDays, setOffsetDays] = useState(0);
  const label =
    range.start === range.end
      ? formatShortDate(range.start)
      : `${formatShortDate(range.start)} – ${formatShortDate(range.end)}`;

  return (
    <motion.button
      type="button"
      aria-label={label}
      initial={false}
      animate={{ left: left + offsetDays * pxPerDay, width }}
      whileHover={readOnly ? undefined : { scale: 1.05 }}
      whileTap={readOnly ? undefined : { scale: 0.95 }}
      transition={offsetDays === 0 ? { type: "spring", stiffness: 380, damping: 32 } : { duration: 0 }}
      className={`absolute top-1.5 flex h-7 cursor-pointer items-center justify-center overflow-hidden rounded-full px-2 text-[11px] font-medium text-white ${readOnly ? "cursor-default" : "cursor-grab"}`}
      style={{ backgroundColor: color }}
      onPointerDown={(event) => {
        if (readOnly || pxPerDay <= 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        const move = (pointer: PointerEvent) => {
          setOffsetDays(Math.round((pointer.clientX - startX) / pxPerDay));
        };
        const finish = (pointer: PointerEvent) => {
          const days = Math.round((pointer.clientX - startX) / pxPerDay);
          setOffsetDays(0);
          target.removeEventListener("pointermove", move);
          target.removeEventListener("pointerup", finish);
          if (days !== 0) {
            onMove(days);
          }
        };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", finish);
      }}
    >
      <span className="truncate">{label}</span>
    </motion.button>
  );
}
