"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { PRESENCE_COLORS } from "@/lib/colors";
import { ColorSwatchPicker } from "@/components/ui/ColorSwatchPicker";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";

export type StatusDraft = {
  id: string;
  label: string;
  color: string;
};

export function StatusOptionsEditor({
  open,
  name,
  options,
  usage,
  onClose,
  onSave,
}: {
  open: boolean;
  name: string;
  options: StatusDraft[];
  usage: (id: string) => number;
  onClose: () => void;
  onSave: (options: StatusDraft[]) => void;
}) {
  return (
    <Dialog open={open} title={`Labels for ${name}`} onClose={onClose}>
      {open ? (
        <StatusOptionsForm key={options.map((option) => option.id).join("|")} options={options} usage={usage} onClose={onClose} onSave={onSave} />
      ) : null}
    </Dialog>
  );
}

function StatusOptionsForm({
  options,
  usage,
  onClose,
  onSave,
}: {
  options: StatusDraft[];
  usage: (id: string) => number;
  onClose: () => void;
  onSave: (options: StatusDraft[]) => void;
}) {
  const [draft, setDraft] = useState(options);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; count: number } | null>(null);
  const labelsValid = draft.every((option) => option.label.trim().length > 0 && option.label.trim().length <= 50);

  function move(from: number, to: number): void {
    if (to < 0 || to >= draft.length || to === from) {
      return;
    }
    setDraft((current) => {
      const next = current.slice();
      const [item] = next.splice(from, 1);
      if (!item) {
        return current;
      }
      next.splice(to, 0, item);
      return next;
    });
  }

  function onGripDown(index: number, event: ReactPointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    const startY = event.clientY;
    const start = index;
    const length = draft.length;
    const stop = (pointer: PointerEvent) => {
      window.removeEventListener("pointerup", stop);
      const next = Math.max(0, Math.min(length - 1, start + Math.round((pointer.clientY - startY) / 40)));
      move(start, next);
    };
    window.addEventListener("pointerup", stop);
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {draft.map((option, index) => (
        <div key={option.id} className="flex items-center gap-2">
          <button
            type="button"
            aria-label={`Drag ${option.label || "label"}`}
            className="cursor-grab rounded-lg p-1 text-muted"
            onPointerDown={(event) => onGripDown(index, event)}
          >
            <GripVertical className="size-3.5" aria-hidden="true" />
          </button>
          <input
            value={option.label}
            maxLength={50}
            aria-label={`Label ${index + 1}`}
            className="h-8 min-w-0 flex-1 rounded border border-border px-2 outline-none"
            onChange={(event) => {
              const label = event.target.value;
              setDraft((current) => current.map((item) => (item.id === option.id ? { ...item, label } : item)));
            }}
          />
          <ColorSwatchPicker
            value={option.color}
            label={`Color for ${option.label || "label"}`}
            onChange={(color) => {
              setDraft((current) => current.map((item) => (item.id === option.id ? { ...item, color } : item)));
            }}
          />
          <button
            type="button"
            aria-label={`Move ${option.label || "label"} up`}
            className="cursor-pointer rounded-lg p-1 text-muted disabled:cursor-not-allowed disabled:opacity-40"
            disabled={index === 0}
            onClick={() => move(index, index - 1)}
          >
            <ChevronUp className="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`Move ${option.label || "label"} down`}
            className="cursor-pointer rounded-lg p-1 text-muted disabled:cursor-not-allowed disabled:opacity-40"
            disabled={index === draft.length - 1}
            onClick={() => move(index, index + 1)}
          >
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`Delete ${option.label || "label"}`}
            className="cursor-pointer rounded-lg p-1 text-danger"
            onClick={() => setPendingDelete({ id: option.id, count: usage(option.id) })}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Add label"
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-primary"
          onClick={() => {
            setDraft((current) => [
              ...current,
              {
                id: crypto.randomUUID(),
                label: "New label",
                color: PRESENCE_COLORS[current.length % PRESENCE_COLORS.length] ?? "#0073ea",
              },
            ]);
          }}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add label
        </button>
        <button
          type="button"
          aria-label="Save labels"
          disabled={!labelsValid}
          className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            onSave(draft.map((option) => ({ ...option, label: option.label.trim() })));
            onClose();
          }}
        >
          Done
        </button>
      </div>
      {pendingDelete
        ? createPortal(
            <ConfirmDialog
              open
              title="Delete label"
              message={`${pendingDelete.count} cells use this label and will be cleared.`}
              confirmLabel="Delete label"
              danger
              onClose={() => setPendingDelete(null)}
              onConfirm={() => {
                const id = pendingDelete.id;
                setDraft((current) => current.filter((option) => option.id !== id));
                setPendingDelete(null);
              }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
