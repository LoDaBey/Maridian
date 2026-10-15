"use client";

import { useMemo, useState } from "react";
import { LayoutGroup } from "framer-motion";
import { generateKeyBetween } from "fractional-indexing";
import type { LocalColumn, LocalGroup, LocalRow } from "@/lib/sheets/apply-local";
import { tagColorFor } from "@/lib/sheets/column-meta";
import type { JsonValue, SheetOp } from "@/lib/sheets/ops";
import { KanbanCard } from "./KanbanCard";
import { KanbanColumn } from "./KanbanColumn";
import {
  cardDetails,
  firstColumn,
  groupingColumns,
  itemDateLabel,
  itemTitle,
  lanesForColumn,
  lanesForGroups,
  personIds,
  tagLabels,
  visibleRowIds,
} from "./board-views";
import type { DirectoryUser, KanbanLane } from "./types";

export function KanbanBoard({
  direction,
  groups,
  rowsByGroup,
  rows,
  rowOrder,
  columns,
  users,
  nameColumnId,
  readOnly,
  canInsert,
  onOpenItem,
  onCommit,
}: {
  direction: "ltr" | "rtl";
  groups: LocalGroup[];
  rowsByGroup: Map<string, string[]>;
  rows: Record<string, LocalRow>;
  rowOrder: string[];
  columns: LocalColumn[];
  users: DirectoryUser[];
  nameColumnId: string | undefined;
  readOnly: boolean;
  canInsert: boolean;
  onOpenItem?: (rowId: string) => void;
  onCommit: (type: SheetOp["type"], payload: SheetOp["payload"]) => void;
}) {
  const choices = useMemo(() => groupingColumns(columns), [columns]);
  const [mode, setMode] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const activeId = mode === "group" || (mode !== null && choices.some((column) => column.id === mode)) ? mode : (choices[0]?.id ?? "group");
  const statusColumn = columns.find((column) => column.id === activeId);
  const byGroup = !statusColumn;
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const namesById = useMemo(() => new Map(users.map((user) => [user.id, user.fullName])), [users]);
  const personColumn = firstColumn(columns, "person");
  const tagsColumn = firstColumn(columns, "tags");
  const lanes = useMemo(() => {
    if (statusColumn) {
      return lanesForColumn(statusColumn, visibleRowIds(groups, rowsByGroup), rows);
    }
    return lanesForGroups(groups, rowsByGroup);
  }, [statusColumn, groups, rowsByGroup, rows]);

  function dropRow(lane: KanbanLane, rowId: string): void {
    setOverId(null);
    if (!rowId || lane.rowIds.includes(rowId) || readOnly) {
      return;
    }
    if (byGroup) {
      const lastId = [...rowOrder].reverse().find((id) => rows[id]?.groupId === lane.id);
      onCommit("row.move", {
        rowId,
        groupId: lane.id,
        position: generateKeyBetween(lastId ? rows[lastId]?.position ?? null : null, null),
      });
      return;
    }
    if (!statusColumn) {
      return;
    }
    onCommit("cell.set", { rowId, columnId: statusColumn.id, value: lane.id || null });
  }

  function addTask(lane: KanbanLane): void {
    if (!canInsert) {
      return;
    }
    const groupId = byGroup ? lane.id : groups[0]?.id;
    if (!groupId) {
      return;
    }
    const lastId = [...rowOrder].reverse().find((id) => rows[id]?.groupId === groupId);
    const rowId = crypto.randomUUID();
    const data: Record<string, JsonValue> = {};
    if (nameColumnId) {
      data[nameColumnId] = "New task";
    }
    if (statusColumn && lane.id) {
      data[statusColumn.id] = lane.id;
    }
    onCommit("row.insert", {
      rowId,
      groupId,
      position: generateKeyBetween(lastId ? rows[lastId]?.position ?? null : null, null),
      data,
    });
    onOpenItem?.(rowId);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <label className="flex items-center gap-2 text-sm text-muted" htmlFor="kanban-group-by">
          Group by
          <select
            id="kanban-group-by"
            aria-label="Group Kanban by"
            value={byGroup ? "group" : activeId}
            className="cursor-pointer rounded-lg border border-border bg-surface px-2 py-1 text-sm text-text outline-none"
            onChange={(event) => setMode(event.target.value)}
          >
            {choices.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
            <option value="group">Group</option>
          </select>
        </label>
      </div>
      <LayoutGroup id="kanban-board">
      <div dir={direction} className="flex min-h-0 flex-1 gap-4 overflow-auto px-4 py-4">
        {lanes.map((lane) => (
          <KanbanColumn
            key={lane.id || "blank"}
            laneKey={lane.id || "blank"}
            label={lane.label}
            color={lane.color}
            count={lane.rowIds.length}
            active={overId === (lane.id || "blank")}
            canAdd={canInsert && Boolean(byGroup ? lane.id : groups[0])}
            onDragOver={() => setOverId(lane.id || "blank")}
            onDrop={(rowId) => dropRow(lane, rowId)}
            onAdd={() => addTask(lane)}
          >
            {lane.rowIds.map((rowId) => {
              const row = rows[rowId];
              const people = personIds(row, personColumn)
                .map((id) => usersById.get(id))
                .filter((user): user is DirectoryUser => user !== undefined);
              const skip = new Set<string>();
              if (nameColumnId) {
                skip.add(nameColumnId);
              }
              if (statusColumn) {
                skip.add(statusColumn.id);
              }
              return (
                <KanbanCard
                  key={rowId}
                  rowId={rowId}
                  title={itemTitle(row, nameColumnId)}
                  tags={tagLabels(row, tagsColumn).slice(0, 3).map((label) => ({ label, color: tagColorFor(label) }))}
                  people={people}
                  date={itemDateLabel(row, columns)}
                  details={cardDetails(row, columns, skip, namesById)}
                  readOnly={readOnly}
                  onOpen={() => onOpenItem?.(rowId)}
                  onHoverLane={setOverId}
                  onDropLane={(laneKey) => {
                    const lane = lanes.find((item) => (item.id || "blank") === laneKey);
                    if (lane) {
                      dropRow(lane, rowId);
                    }
                  }}
                />
              );
            })}
          </KanbanColumn>
        ))}
      </div>
      </LayoutGroup>
    </div>
  );
}
