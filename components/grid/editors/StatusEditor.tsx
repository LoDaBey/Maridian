"use client";

import { PRESENCE_COLORS } from "@/lib/colors";
import type { JsonValue } from "@/lib/sheets/ops";
import type { LocalColumn } from "@/lib/sheets/apply-local";
import { labeledOptions, type StatusOption } from "@/lib/sheets/values";
import { OptionNameField } from "./OptionNameField";

const OPTION_LIMIT = 50;

export function StatusEditor({
  column,
  onCommit,
  onCancel,
  onAddOption,
  onInvalid,
}: {
  column: LocalColumn;
  onCommit: (value: JsonValue | null, move: "down" | "next" | "none") => void;
  onCancel: () => void;
  onAddOption: (options: StatusOption[]) => void;
  onInvalid: (message: string) => void;
}) {
  const options = labeledOptions(column.settings);
  const custom = column.type !== "priority";

  function addName(label: string): void {
    const match = options.find((option) => option.label.toLowerCase() === label.toLowerCase());
    if (match) {
      onCommit(match.id, "none");
      return;
    }
    if (options.length >= OPTION_LIMIT) {
      onInvalid("This column can have 50 names.");
      return;
    }
    const created: StatusOption = {
      id: crypto.randomUUID(),
      label,
      color: PRESENCE_COLORS[options.length % PRESENCE_COLORS.length] ?? "#0073ea",
    };
    onAddOption([...options, created]);
    onCommit(created.id, "none");
  }

  return (
    <div
      tabIndex={-1}
      autoFocus
      className="absolute start-0 top-full z-30 flex max-h-72 w-60 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow outline-none"
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      {custom ? <OptionNameField onAdd={addName} /> : null}
      <div className="min-h-0 overflow-auto p-1">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-label={`Set status ${option.label}`}
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-start text-[13px]"
            onClick={() => onCommit(option.id, "none")}
          >
            <span className="size-3 rounded-full" style={{ backgroundColor: option.color }} />
            {option.label}
          </button>
        ))}
        <button
          type="button"
          aria-label="Clear status"
          className="w-full cursor-pointer rounded-lg px-2 py-1 text-start text-[13px] text-muted"
          onClick={() => onCommit(null, "none")}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
