"use client";

import type { DirectoryUser } from "./types";
import type { LocalColumn } from "@/lib/sheets/apply-local";
import type { JsonValue } from "@/lib/sheets/ops";

export function ColumnSummary({
  columns,
  widths,
  rows,
  gutter,
  users,
  label,
}: {
  columns: LocalColumn[];
  widths: number[];
  rows: Array<{ data: Record<string, JsonValue>; createdBy: string | null }>;
  gutter: number;
  users: DirectoryUser[];
  label?: string;
}) {
  return (
    <div className="flex h-10 text-[11px] text-muted">
      <div className="sticky start-0 z-10 flex h-10 shrink-0 items-center justify-center bg-surface px-1" style={{ width: gutter }}>
        {label ?? ""}
      </div>
      {columns.map((column, index) => (
        <div
          key={column.id}
          className="flex h-10 shrink-0 items-center justify-center overflow-hidden px-2 text-center"
          style={{ width: widths[index] ?? column.width }}
        >
          <SummaryValue column={column} rows={rows} users={users} />
        </div>
      ))}
    </div>
  );
}

function SummaryValue({
  column,
  rows,
  users,
}: {
  column: LocalColumn;
  rows: Array<{ data: Record<string, JsonValue>; createdBy: string | null }>;
  users: DirectoryUser[];
}) {
  const total = rows.length;
  if (column.type === "status" || column.type === "priority" || column.type === "dropdown") {
    return <StatusBar column={column} rows={rows} />;
  }
  if (column.type === "number") {
    const values = rows.map((row) => row.data[column.id]).filter((value): value is number => typeof value === "number");
    if (values.length === 0) {
      return null;
    }
    const sum = values.reduce((acc, value) => acc + value, 0);
    const avg = sum / values.length;
    return <span title={`Sum ${sum} · Average ${avg}`}>{formatNumber(sum)} · avg {formatNumber(avg)}</span>;
  }
  if (column.type === "rating") {
    const values = rows.map((row) => row.data[column.id]).filter((value): value is number => typeof value === "number");
    if (values.length === 0) {
      return null;
    }
    const avg = values.reduce((acc, value) => acc + value, 0) / values.length;
    return <span>avg {formatNumber(avg)}</span>;
  }
  if (column.type === "date" || column.type === "due_date") {
    const dates = rows
      .map((row) => row.data[column.id])
      .filter((value): value is string => typeof value === "string")
      .sort();
    if (dates.length === 0) {
      return null;
    }
    const first = dates[0];
    const last = dates[dates.length - 1];
    return <span>{first === last ? first : `${first} – ${last}`}</span>;
  }
  if (column.type === "person" || column.type === "created_by") {
    const ids = new Set<string>();
    for (const row of rows) {
      if (column.type === "created_by" && row.createdBy) {
        ids.add(row.createdBy);
        continue;
      }
      const value = row.data[column.id];
      if (Array.isArray(value)) {
        for (const id of value) {
          if (typeof id === "string") {
            ids.add(id);
          }
        }
      }
    }
    const people = users.filter((user) => ids.has(user.id)).slice(0, 4);
    if (people.length === 0) {
      return null;
    }
    return (
      <span className="flex items-center">
        {people.map((person) => (
          <span
            key={person.id}
            title={person.fullName}
            className="-ms-1 inline-flex size-5 first:ms-0 items-center justify-center rounded-full text-[9px] text-white"
            style={{ backgroundColor: person.avatarColor }}
          >
            {initials(person.fullName)}
          </span>
        ))}
        {ids.size > people.length ? <span className="ms-1">+{ids.size - people.length}</span> : null}
      </span>
    );
  }
  if (column.type === "checkbox") {
    const ticked = rows.filter((row) => row.data[column.id] === true).length;
    return <span>{ticked} / {total}</span>;
  }
  const filled = rows.filter((row) => {
    const value = row.data[column.id];
    return value !== undefined && value !== null && value !== "";
  }).length;
  if (filled === 0 || total === 0) {
    return null;
  }
  return <span>{filled} filled</span>;
}

function StatusBar({
  column,
  rows,
}: {
  column: LocalColumn;
  rows: Array<{ data: Record<string, JsonValue> }>;
}) {
  const options = Array.isArray(column.settings.options) ? column.settings.options : [];
  const counts = new Map<string, { count: number; color: string }>();
  for (const option of options) {
    if (!option || typeof option !== "object" || Array.isArray(option)) {
      continue;
    }
    if (typeof option.id === "string" && typeof option.color === "string") {
      counts.set(option.id, { count: 0, color: option.color });
    }
  }
  let filled = 0;
  for (const row of rows) {
    const value = row.data[column.id];
    const ids = typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    if (ids.length === 0) {
      continue;
    }
    filled += 1;
    for (const id of ids) {
      const current = counts.get(id);
      if (current) {
        current.count += 1;
      }
    }
  }
  if (filled === 0) {
    return null;
  }
  return (
    <span className="flex h-2 w-full overflow-hidden rounded-full bg-track" title={`${filled} labeled`}>
      {[...counts.values()].map((item, index) =>
        item.count === 0 ? null : (
          <span
            key={`${item.color}-${index}`}
            className="h-full"
            style={{ width: `${(item.count / filled) * 100}%`, backgroundColor: item.color }}
          />
        ),
      )}
    </span>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0] ?? "").join("").toUpperCase() || "?";
}
