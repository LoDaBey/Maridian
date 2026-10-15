"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { ColumnType } from "@/lib/db-types";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { Tooltip } from "@/components/ui/Tooltip";
import { COLUMN_TYPE_OPTIONS } from "./ColumnMenu";

export const ADD_COLUMN_WIDTH = 36;

const BUTTON_CLASS: Record<"icon" | "labeled" | "compact", string> = {
  icon: "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-white",
  labeled: "h-9 cursor-pointer rounded-lg px-3 text-start text-[13px] text-primary",
  compact:
    "flex size-7 cursor-pointer items-center justify-center rounded-lg text-primary hover:bg-row",
};

export function AddColumnButton({
  onCreate,
  variant = "icon",
}: {
  onCreate: (type: ColumnType) => void;
  variant?: "icon" | "labeled" | "compact";
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; right: number; height: number } | null>(
    null,
  );

  const open = menu !== null;
  const button = (
    <button
      type="button"
      aria-label="Add column"
      aria-haspopup="menu"
      aria-expanded={open}
      className={BUTTON_CLASS[variant]}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setMenu({ x: rect.left, y: rect.bottom, right: rect.right, height: rect.height });
      }}
    >
      {variant === "labeled" ? "+ Add column" : <Plus className="size-4" aria-hidden="true" />}
    </button>
  );

  return (
    <>
      {variant === "labeled" ? (
        button
      ) : (
        <Tooltip label="Add column" disabled={open}>
          {button}
        </Tooltip>
      )}
      <Menu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        anchorRight={menu?.right}
        anchorHeight={menu?.height ?? 0}
        label="Add column"
        onClose={() => setMenu(null)}
      >
        {COLUMN_TYPE_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <MenuItem
              key={option.type}
              label={option.label}
              icon={<Icon className="size-3.5 text-muted" aria-hidden="true" />}
              onSelect={() => {
                setMenu(null);
                onCreate(option.type);
              }}
            />
          );
        })}
      </Menu>
    </>
  );
}
