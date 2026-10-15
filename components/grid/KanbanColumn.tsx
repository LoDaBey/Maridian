"use client";

import { Plus } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { ActionButton } from "./ActionButton";

export function KanbanColumn({
  laneKey,
  label,
  color,
  count,
  active,
  canAdd,
  children,
  onDragOver,
  onDrop,
  onAdd,
}: {
  laneKey: string;
  label: string;
  color: string;
  count: number;
  active: boolean;
  canAdd: boolean;
  children: ReactNode;
  onDragOver: () => void;
  onDrop: (rowId: string) => void;
  onAdd: () => void;
}) {
  return (
    <section
      aria-label={label}
      data-kanban-lane={laneKey}
      className={`flex w-[280px] shrink-0 flex-col rounded-lg ${active ? "bg-selection" : "bg-transparent"}`}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const rowId = event.dataTransfer.getData("application/x-monitor-row") || event.dataTransfer.getData("text/plain");
        if (rowId) {
          onDrop(rowId);
        }
      }}
    >
      <header className="px-1 pb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="truncate text-sm font-semibold text-text">{label}</h2>
          <span className="text-xs text-muted">({count})</span>
        </div>
        <span className="mt-1 block h-0.5 rounded-full" style={{ backgroundColor: color }} />
      </header>
      {canAdd ? (
        <ActionButton
          aria-label={`Add item to ${label}`}
          className="mb-2 flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-surface"
          onClick={onAdd}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          New task
        </ActionButton>
      ) : null}
      <motion.div layout className="flex flex-col gap-2">
        <AnimatePresence initial={false}>{children}</AnimatePresence>
      </motion.div>
    </section>
  );
}
