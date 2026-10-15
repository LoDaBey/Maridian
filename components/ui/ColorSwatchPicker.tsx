"use client";

import { PRESENCE_COLORS } from "@/lib/colors";

export function ColorSwatchPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (color: string) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {PRESENCE_COLORS.map((color) => {
        const selected = value.toLowerCase() === color;
        return (
          <button
            key={color}
            type="button"
            aria-label={`${label} ${color}`}
            aria-pressed={selected}
            className="size-5 cursor-pointer rounded-full outline-none ring-offset-1 focus-visible:ring-2"
            style={{
              backgroundColor: color,
              boxShadow: selected ? "0 0 0 2px #fff, 0 0 0 3px #323338" : undefined,
            }}
            onClick={() => onChange(color)}
          />
        );
      })}
    </div>
  );
}
