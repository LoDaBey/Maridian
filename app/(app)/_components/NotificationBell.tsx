"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import type { NotificationItem } from "@/lib/db-types";
import { useNotifications } from "./use-notifications";

export function NotificationBell() {
  const { items, unread, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <div className="relative">
      <Tooltip label="Notifications" disabled={open}>
        <button
          type="button"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          className="relative flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-row hover:text-text"
          onClick={() => setOpen((current) => !current)}
        >
          <Bell className="size-4" aria-hidden="true" />
          {unread > 0 ? (
            <span className="absolute -end-0.5 -top-0.5 min-w-4 rounded-full bg-red-500 px-1 text-[10px] text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </button>
      </Tooltip>
      {open ? (
        <div className="absolute end-0 z-50 mt-2 w-80 rounded-lg border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-medium">Notifications</p>
            <button
              type="button"
              aria-label="Mark all notifications as read"
              className="cursor-pointer rounded-lg px-2 py-1 text-xs text-primary"
              onClick={() => void markRead()}
            >
              Mark all read
            </button>
          </div>
          <ul className="max-h-80 overflow-auto">
            {items.length === 0 ? (
              <li className="px-3 py-4 text-sm text-muted">No notifications yet.</li>
            ) : (
              items.map((item) => (
                <li key={item.id}>
                  <NotificationRow
                    item={item}
                    onOpen={() => {
                      void markRead([item.id]);
                      setOpen(false);
                      router.push(item.href);
                    }}
                  />
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function NotificationRow({ item, onOpen }: { item: NotificationItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label={`${item.actorName} ${item.excerpt}`}
      className={`flex w-full cursor-pointer gap-2 rounded-lg px-3 py-2 text-start hover:bg-gray-50 ${item.readAt ? "" : "bg-primary/5"}`}
      onClick={onOpen}
    >
      <span
        className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] text-white"
        style={{ backgroundColor: item.actorColor }}
      >
        {item.actorName.slice(0, 1).toUpperCase()}
      </span>
      <span>
        <span className="block text-sm">
          <span className="font-medium">{item.actorName}</span> {item.excerpt}
        </span>
        <span className="block text-xs text-muted">
          {item.sheetName} · {new Date(item.createdAt).toLocaleString()}
        </span>
      </span>
    </button>
  );
}
