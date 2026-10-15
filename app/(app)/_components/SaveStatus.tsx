"use client";

import { Check } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import { useSheetStore } from "@/stores/sheet-store";

function subscribeToSlot(): () => void {
  return () => {};
}

function readSlot(): HTMLElement | null {
  return document.getElementById("save-status-slot");
}

function emptySlot(): null {
  return null;
}

export function SaveStatus() {
  const store = useSheetStore();
  const status = useStore(store, (state) => state.status);
  const pending = useStore(store, (state) => state.pending.size);
  const lastSavedAt = useStore(store, (state) => state.lastSavedAt);
  const slot = useSyncExternalStore(subscribeToSlot, readSlot, emptySlot);

  if (!slot || status === "connecting") {
    return null;
  }

  const savedAt = lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

  let content: ReactNode;
  if (status === "offline") {
    content = (
      <span className="text-amber-700">Offline. {pending} changes will sync when you reconnect</span>
    );
  } else if (status === "error") {
    content = <span className="text-danger">Couldn&apos;t save. Retrying…</span>;
  } else if (status === "saving" || pending > 0) {
    content = (
      <span className="inline-flex items-center gap-1 text-muted">
        <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        Saving…
      </span>
    );
  } else {
    content = (
      <span className="inline-flex items-center gap-1 text-success" title={savedAt ? `Saved at ${savedAt}` : "All changes saved"}>
        <Check className="size-3.5" aria-hidden="true" />
        All changes saved
      </span>
    );
  }

  return createPortal(
    <p className="text-xs" aria-live="polite">
      {content}
    </p>,
    slot,
  );
}
