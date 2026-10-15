"use client";

import { useEffect, useState } from "react";
interface ActivityItem {
  id: string;
  userName: string;
  avatarColor: string;
  columnName: string | null;
  oldText: string;
  newText: string;
  createdAt: string;
}

export function ItemActivity({ sheetId, rowId }: { sheetId: string; rowId: string }) {
  const [entries, setEntries] = useState<ActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/sheets/${sheetId}/activity?rowId=${rowId}&limit=50`)
      .then(async (response) => {
        const data = (await response.json()) as { entries?: ActivityItem[]; error?: string };
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setError(data.error ?? "Could not load activity.");
          return;
        }
        setEntries(data.entries ?? []);
        setError(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sheetId, rowId]);

  if (error) {
    return <p className="p-4 text-sm text-muted">{error}</p>;
  }
  if (entries.length === 0) {
    return <p className="p-4 text-sm text-muted">No activity yet.</p>;
  }

  return (
    <ol className="flex flex-col gap-3 p-4">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-lg border border-border p-3 text-sm">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex size-6 items-center justify-center rounded-full text-[10px] text-white"
              style={{ backgroundColor: entry.avatarColor }}
            >
              {initials(entry.userName)}
            </span>
            <span className="font-medium">{entry.userName}</span>
            <span className="text-xs text-muted">{new Date(entry.createdAt).toLocaleString()}</span>
          </div>
          <p className="mt-1 text-muted">
            {entry.columnName ? `${entry.columnName}: ` : ""}
            {entry.oldText || "—"} → {entry.newText || "—"}
          </p>
        </li>
      ))}
    </ol>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0] ?? "").join("").toUpperCase() || "?";
}
