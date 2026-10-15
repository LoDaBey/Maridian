"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import type { CardDetail, DirectoryUser } from "./types";

const DRAG_SLOP = 4;

export function KanbanCard({
  rowId,
  title,
  tags,
  people,
  date,
  details,
  readOnly,
  onOpen,
  onHoverLane,
  onDropLane,
}: {
  rowId: string;
  title: string;
  tags: Array<{ label: string; color: string }>;
  people: DirectoryUser[];
  date: string;
  details: CardDetail[];
  readOnly: boolean;
  onOpen: () => void;
  onHoverLane: (laneKey: string | null) => void;
  onDropLane: (laneKey: string) => void;
}) {
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const handled = useRef(false);

  return (
    <motion.div
      layout
      layoutId={rowId}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
    >
      <button
        type="button"
        aria-label={title}
        className="flex w-full cursor-pointer flex-col gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-start shadow-sm hover:border-primary/40"
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          handled.current = false;
          press.current = { x: event.clientX, y: event.clientY, moved: false };
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Some presses cannot capture the pointer. The button still receives the release.
          }
        }}
        onPointerMove={(event) => {
          const current = press.current;
          if (!current) {
            return;
          }
          const dx = event.clientX - current.x;
          const dy = event.clientY - current.y;
          if (!current.moved && dx * dx + dy * dy > DRAG_SLOP * DRAG_SLOP) {
            current.moved = true;
          }
          if (!current.moved || readOnly) {
            return;
          }
          onHoverLane(laneAt(event.clientX, event.clientY));
        }}
        onPointerUp={(event) => {
          const current = press.current;
          press.current = null;
          onHoverLane(null);
          if (!current) {
            return;
          }
          handled.current = true;
          if (!current.moved) {
            onOpen();
            return;
          }
          if (readOnly) {
            return;
          }
          const laneKey = laneAt(event.clientX, event.clientY);
          if (laneKey) {
            onDropLane(laneKey);
          }
        }}
        onClick={() => {
          if (handled.current) {
            handled.current = false;
            return;
          }
          onOpen();
        }}
      >
        <span className="line-clamp-3 text-sm font-medium text-text">{title}</span>
        {details.length > 0 ? (
          <span className="flex flex-col gap-0.5">
            {details.map((detail) => (
              <span key={detail.id} className="flex min-w-0 gap-2 text-[11px] leading-4">
                <span className="shrink-0 text-muted">{detail.label}</span>
                <span className="min-w-0 truncate text-text">{detail.text}</span>
              </span>
            ))}
          </span>
        ) : null}
        {tags.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span
                key={tag.label}
                className="max-w-full truncate rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
                style={{ backgroundColor: tag.color }}
              >
                {tag.label}
              </span>
            ))}
          </span>
        ) : null}
        {people.length > 0 || date ? (
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center">
              {people.slice(0, 3).map((person, index) => (
                <span
                  key={person.id}
                  title={person.fullName}
                  className="inline-flex size-6 items-center justify-center rounded-full text-[10px] font-medium text-white ring-2 ring-surface"
                  style={{ backgroundColor: person.avatarColor, marginInlineStart: index === 0 ? 0 : -6 }}
                >
                  {initials(person.fullName)}
                </span>
              ))}
            </span>
            {date ? <span className="text-[11px] text-muted">{date}</span> : null}
          </span>
        ) : null}
      </button>
    </motion.div>
  );
}

function laneAt(x: number, y: number): string | null {
  const hit = document.elementFromPoint(x, y);
  return hit?.closest("[data-kanban-lane]")?.getAttribute("data-kanban-lane") ?? null;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0] ?? "").join("").toUpperCase() || "?";
}
