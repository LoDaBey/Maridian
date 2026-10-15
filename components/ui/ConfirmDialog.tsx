"use client";

import type { ReactNode } from "react";
import { Dialog } from "./Dialog";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <div className="mt-2 text-sm text-muted">{message}</div>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          aria-label="Cancel"
          className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-text"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          autoFocus
          aria-label={confirmLabel}
          className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm text-white ${danger ? "bg-danger" : "bg-primary"}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
