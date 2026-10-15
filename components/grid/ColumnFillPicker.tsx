"use client";

import { FILL_COLORS } from "@/lib/db-types";
import { ColorPicker } from "./ColorPicker";

export function ColumnFillPicker({
  value,
  label,
  onChange,
  onClear,
}: {
  value?: string;
  label: string;
  onChange: (color: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="p-1">
      <ColorPicker value={value ?? ""} colors={FILL_COLORS} label={label} onChange={onChange} />
      <button
        type="button"
        aria-label={`Clear ${label.toLowerCase()}`}
        className="mt-1 w-full cursor-pointer rounded-lg px-2 py-1.5 text-start text-sm text-muted hover:bg-row"
        onClick={onClear}
      >
        None
      </button>
    </div>
  );
}
