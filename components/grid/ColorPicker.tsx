"use client";

import { GROUP_COLORS } from "@/lib/db-types";

export function ColorPicker({
  value,
  colors = GROUP_COLORS,
  label = "Group color",
  onChange,
}: {
  value: string;
  colors?: readonly string[];
  label?: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="grid grid-cols-6 gap-1.5 p-1" role="listbox" aria-label={label}>
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          role="option"
          aria-selected={value.toLowerCase() === color.toLowerCase()}
          aria-label={`Color ${color}`}
          className={`size-6 cursor-pointer rounded-lg border ${value.toLowerCase() === color.toLowerCase() ? "border-text" : "border-transparent"}`}
          style={{ backgroundColor: color }}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}
