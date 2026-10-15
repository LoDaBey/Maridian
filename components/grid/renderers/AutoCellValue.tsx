"use client";

import type { DirectoryUser } from "../types";
import type { LocalColumn, LocalRow } from "@/lib/sheets/apply-local";

export function AutoCellValue({
  column,
  row,
  users,
}: {
  column: LocalColumn;
  row: LocalRow;
  users: DirectoryUser[];
}) {
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
