"use client";

import { ChartColumnBig, GanttChart, SquareKanban, Table2 } from "lucide-react";
import { LayoutGroup, motion } from "framer-motion";
import { ActionButton } from "./ActionButton";
import type { BoardLayout } from "./types";

const VIEWS: Array<{ id: BoardLayout; label: string; icon: typeof Table2 }> = [
  { id: "table", label: "Main table", icon: Table2 },
  { id: "timeline", label: "Timeline", icon: GanttChart },
  { id: "kanban", label: "Kanban", icon: SquareKanban },
  { id: "chart", label: "Chart", icon: ChartColumnBig },
];

export function ViewSwitcher({
  layout,
  onChange,
}: {
  layout: BoardLayout;
  onChange: (layout: BoardLayout) => void;
}) {
  return (
    <LayoutGroup id="board-views">
      <nav aria-label="Board views" className="flex items-end gap-1 border-b border-border bg-surface px-3">
        {VIEWS.map((view) => {
          const active = layout === view.id;
          const Icon = view.icon;
          return (
            <ActionButton
              key={view.id}
              aria-label={view.label}
              aria-current={active ? "page" : undefined}
              className={`relative flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm ${active ? "font-medium text-primary" : "text-muted hover:bg-row"}`}
              onClick={() => onChange(view.id)}
            >
              <Icon className="size-4" aria-hidden="true" />
              {view.label}
              {active ? (
                <motion.span
                  layoutId="board-view-underline"
                  className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary"
                />
              ) : null}
            </ActionButton>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}
