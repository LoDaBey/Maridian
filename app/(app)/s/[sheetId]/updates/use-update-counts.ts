"use client";

import { useEffect, useState } from "react";
import { getSocket } from "@/lib/realtime/client";

export function useUpdateCounts(sheetId: string): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/sheets/${sheetId}/update-counts`)
      .then((response) => response.json())
      .then((data: { counts?: Record<string, number> }) => {
        if (!cancelled && data.counts) {
          setCounts(data.counts);
        }
      });
    const socket = getSocket();
    const onChange = (payload: unknown) => {
      if (!isRecord(payload) || payload.sheetId !== sheetId || typeof payload.rowId !== "string") {
        return;
      }
      const rowId = payload.rowId;
      void fetch(`/api/sheets/${sheetId}/update-counts`)
        .then((response) => response.json())
        .then((data: { counts?: Record<string, number> }) => {
          if (data.counts) {
            setCounts(data.counts);
            return;
          }
          setCounts((current) => current);
        });
      void rowId;
    };
    socket.on("update.created", onChange);
    socket.on("update.deleted", onChange);
    return () => {
      cancelled = true;
      socket.off("update.created", onChange);
      socket.off("update.deleted", onChange);
    };
  }, [sheetId]);

  return counts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
