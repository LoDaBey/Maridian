"use client";

import { useCallback, useEffect, useState } from "react";
import type { FileAttachment, RowUpdateDto } from "@/lib/db-types";
import { getSocket } from "@/lib/realtime/client";

export function useRowUpdates(sheetId: string, rowId: string | null) {
  const [updates, setUpdates] = useState<RowUpdateDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!rowId) {
      setUpdates([]);
      return;
    }
    setLoading(true);
    const response = await fetch(`/api/sheets/${sheetId}/rows/${rowId}/updates`);
    const data = (await response.json()) as { updates?: RowUpdateDto[]; error?: string };
    if (!response.ok) {
      setError(data.error ?? "Could not load updates.");
      setLoading(false);
      return;
    }
    setUpdates(data.updates ?? []);
    setError(null);
    setLoading(false);
    void fetch(`/api/sheets/${sheetId}/rows/${rowId}/updates/seen`, { method: "POST" });
  }, [sheetId, rowId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!rowId) {
      return;
    }
    const socket = getSocket();
    const onChange = (payload: unknown) => {
      if (!isRecord(payload) || payload.sheetId !== sheetId || payload.rowId !== rowId) {
        return;
      }
      void refresh();
    };
    // Do not listen for update.seen: mark-as-seen emits it and would refresh forever.
    socket.on("update.created", onChange);
    socket.on("update.edited", onChange);
    socket.on("update.deleted", onChange);
    socket.on("update.reacted", onChange);
    return () => {
      socket.off("update.created", onChange);
      socket.off("update.edited", onChange);
      socket.off("update.deleted", onChange);
      socket.off("update.reacted", onChange);
    };
  }, [sheetId, rowId, refresh]);

  async function post(body: string, mentions: string[], attachments: FileAttachment[] = []): Promise<string | null> {
    if (!rowId) {
      return "Item not found.";
    }
    const response = await fetch(`/api/sheets/${sheetId}/rows/${rowId}/updates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, mentions, attachments }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      return data.error ?? "Could not post the update.";
    }
    await refresh();
    return null;
  }

  async function edit(updateId: string, body: string, mentions: string[]): Promise<string | null> {
    if (!rowId) {
      return "Item not found.";
    }
    const response = await fetch(`/api/sheets/${sheetId}/rows/${rowId}/updates/${updateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, mentions }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      return data.error ?? "Could not edit the update.";
    }
    await refresh();
    return null;
  }

  async function remove(updateId: string): Promise<string | null> {
    if (!rowId) {
      return "Item not found.";
    }
    const response = await fetch(`/api/sheets/${sheetId}/rows/${rowId}/updates/${updateId}`, { method: "DELETE" });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      return data.error ?? "Could not delete the update.";
    }
    await refresh();
    return null;
  }

  async function reply(updateId: string, body: string, mentions: string[]): Promise<string | null> {
    if (!rowId) {
      return "Item not found.";
    }
    const response = await fetch(`/api/sheets/${sheetId}/rows/${rowId}/updates/${updateId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, mentions }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      return data.error ?? "Could not post the reply.";
    }
    await refresh();
    return null;
  }

  async function react(updateId: string): Promise<void> {
    if (!rowId) {
      return;
    }
    await fetch(`/api/sheets/${sheetId}/rows/${rowId}/updates/${updateId}/reactions`, { method: "POST" });
    await refresh();
  }

  return { updates, loading, error, post, edit, remove, reply, react, refresh };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
