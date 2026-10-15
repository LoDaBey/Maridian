"use client";

import { useCallback, useEffect, useState } from "react";
import type { NotificationItem } from "@/lib/db-types";
import { getSocket } from "@/lib/realtime/client";

export function useNotifications() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/notifications");
    const data = (await response.json()) as { notifications?: NotificationItem[]; unread?: number };
    if (response.ok) {
      setItems(data.notifications ?? []);
      setUnread(data.unread ?? 0);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const socket = getSocket();
    const onCreated = (payload: unknown) => {
      if (!isRecord(payload) || typeof payload.id !== "string") {
        return;
      }
      void refresh();
    };
    socket.on("notification:created", onCreated);
    return () => {
      socket.off("notification:created", onCreated);
    };
  }, [refresh]);

  async function markRead(ids?: string[]): Promise<void> {
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids ? { ids } : { all: true }),
    });
    await refresh();
  }

  return { items, unread, markRead, refresh };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
