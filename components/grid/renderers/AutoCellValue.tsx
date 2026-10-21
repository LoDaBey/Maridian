"use client";

import type { DirectoryUser } from "../types";
import type { LocalColumn, LocalRow } from "@/lib/sheets/apply-local";
import { rowProgress } from "@/lib/sheets/progress";
import { useColumns } from "@/stores/sheet-store";

export function AutoCellValue({
  column,
  row,
  users,
}: {
  column: LocalColumn;
  row: LocalRow;
  users: DirectoryUser[];
}) {
  if (column.type === "progress") {
    return <ProgressValue row={row} />;
  }
  if (column.type === "item_id") {
    return <span className="block truncate px-2 text-center leading-10 text-muted">#{row.itemNumber || "—"}</span>;
  }
  if (column.type === "created_at" || column.type === "updated_at") {
    const raw = column.type === "created_at" ? row.createdAt : row.updatedAt;
    return <span className="block w-full truncate px-2 text-center leading-10 text-muted">{formatDateTime(raw)}</span>;
  }
  if (column.type === "created_by") {
    const user = users.find((item) => item.id === row.createdBy);
    if (!user) {
      return null;
    }
    return (
      <span className="flex h-full w-full items-center justify-center gap-1 px-1">
        <span
          className="inline-flex size-7 items-center justify-center rounded-full text-[11px] font-medium text-white ring-2 ring-row"
          style={{ backgroundColor: user.avatarColor }}
        >
          {initials(user.fullName)}
        </span>
        <span className="truncate">{user.fullName}</span>
      </span>
    );
  }
  return null;
}

/** Share of the row's status columns that are done, as a thin Monday-style bar. */
function ProgressValue({ row }: { row: LocalRow }) {
  const columns = useColumns();
  const progress = rowProgress(row.data, columns);
  if (!progress) {
    return (
      <span className="block truncate px-2 text-center leading-10 text-muted" title="Add a status column with a Done label">
        —
      </span>
    );
  }
  return (
    <span
      className="flex h-full w-full items-center gap-2 px-2"
      title={`${progress.done} of ${progress.total} status columns done`}
    >
      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-track">
        <span className="block h-full rounded-full bg-success" style={{ width: `${progress.percent}%` }} />
      </span>
      <span className="w-9 shrink-0 text-end text-xs tabular-nums text-muted">{progress.percent}%</span>
    </span>
  );
}

function formatDateTime(value: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0] ?? "").join("").toUpperCase() || "?";
}
