"use client";

import { useState } from "react";
import { generateKeyBetween } from "fractional-indexing";
import {
  AlignLeft,
  Calendar,
  CalendarRange,
  CheckSquare,
  CircleDot,
  Clock,
  Fingerprint,
  Flag,
  Gauge,
  Hash,
  Link2,
  ListChecks,
  Mail,
  Paperclip,
  Phone,
  Star,
  Tags,
  TriangleAlert,
  Type,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { defaultColumnSettings, PRIORITY_OPTIONS } from "@/lib/sheets/column-meta";
import type { ColumnType } from "@/lib/db-types";
import type { JsonValue, SheetOp } from "@/lib/sheets/ops";
import { convertValue } from "@/lib/sheets/values";
import { useSheetStore } from "@/stores/sheet-store";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { ColumnFillPicker } from "./ColumnFillPicker";
import { StatusOptionsEditor, type StatusDraft } from "./StatusOptionsEditor";
import { ProtectDialog } from "./ProtectDialog";
import { useIsProtected, useProtection } from "./ProtectionContext";
import { readFillColor } from "@/lib/sheets/values";

export const COLUMN_TYPE_OPTIONS: Array<{ type: ColumnType; label: string; icon: LucideIcon }> = [
  { type: "text", label: "Text", icon: Type },
  { type: "long_text", label: "Long text", icon: AlignLeft },
  { type: "link", label: "Link", icon: Link2 },
  { type: "email", label: "Email", icon: Mail },
  { type: "phone", label: "Phone", icon: Phone },
  { type: "date", label: "Date", icon: Calendar },
  { type: "person", label: "Person", icon: UserRound },
  { type: "status", label: "Status", icon: CircleDot },
  { type: "number", label: "Number", icon: Hash },
  { type: "checkbox", label: "Checkbox", icon: CheckSquare },
  { type: "timeline", label: "Timeline", icon: CalendarRange },
  { type: "tags", label: "Tags", icon: Tags },
  { type: "dropdown", label: "Dropdown", icon: ListChecks },
  { type: "country", label: "Country", icon: Flag },
  { type: "priority", label: "Priority", icon: TriangleAlert },
  { type: "rating", label: "Rating", icon: Star },
  { type: "files", label: "Files", icon: Paperclip },
  { type: "due_date", label: "Due date", icon: Calendar },
  { type: "created_by", label: "Created by", icon: UserRound },
  { type: "created_at", label: "Created at", icon: Calendar },
  { type: "updated_at", label: "Updated at", icon: Clock },
  { type: "item_id", label: "Item ID", icon: Fingerprint },
  { type: "progress", label: "Progress", icon: Gauge },
];

export function starterStatusOptions(): StatusDraft[] {
  return [
    { id: crypto.randomUUID(), label: "Done", color: "#00c875" },
    { id: crypto.randomUUID(), label: "Working on it", color: "#fdab3d" },
    { id: crypto.randomUUID(), label: "Stuck", color: "#e2445c" },
  ];
}

export function starterDropdownOptions(): StatusDraft[] {
  return [
    { id: crypto.randomUUID(), label: "Option 1", color: "#579bfc" },
    { id: crypto.randomUUID(), label: "Option 2", color: "#00c875" },
    { id: crypto.randomUUID(), label: "Option 3", color: "#fdab3d" },
  ];
}

export function settingsForNewColumn(type: ColumnType): Record<string, unknown> | undefined {
  if (type === "status") {
    return { options: starterStatusOptions() };
  }
  if (type === "dropdown") {
    return { options: starterDropdownOptions() };
  }
  if (type === "priority") {
    return { options: PRIORITY_OPTIONS.map((option) => ({ ...option })) };
  }
  const defaults = defaultColumnSettings(type);
  return Object.keys(defaults).length ? defaults : undefined;
}

type Commit = (type: SheetOp["type"], payload: SheetOp["payload"]) => void;

export function ColumnMenu({
  open,
  x,
  y,
  columnId,
  name,
  type,
  settings,
  index,
  columnCount,
  direction,
  onClose,
  canManage,
  canDelete,
  canStyle,
  onRename,
  onCommit,
  onOfferUndo,
}: {
  open: boolean;
  x: number;
  y: number;
  columnId: string;
  name: string;
  type: ColumnType;
  settings: Record<string, JsonValue>;
  index: number;
  columnCount: number;
  direction: "ltr" | "rtl";
  onClose: () => void;
  canManage: boolean;
  canDelete: boolean;
  canStyle: boolean;
  onRename: () => void;
  onCommit: Commit;
  onOfferUndo: (message: string, undo: () => void) => void;
}) {
  const store = useSheetStore();
  const protection = useProtection();
  const isProtected = useIsProtected("column", columnId);
  const [protectOpen, setProtectOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const [pendingType, setPendingType] = useState<{ type: ColumnType; cleared: number } | null>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState<"header" | "cells" | null>(null);
  const multiple = settings.multiple === true;
  const headerColor = readFillColor(settings, "headerColor");
  const fillColor = readFillColor(settings, "fillColor");
  const atLeft = direction === "rtl" ? index === columnCount - 1 : index === 0;
  const atRight = direction === "rtl" ? index === 0 : index === columnCount - 1;

  function closeAll(): void {
    setTypesOpen(false);
    setFillOpen(null);
    onClose();
  }

  function clearedFor(nextType: ColumnType): number {
    const toSettings = settingsForNewColumn(nextType) ?? {};
    const rows = store.getState().rows;
    let count = 0;
    for (const row of Object.values(rows)) {
      if (row.deleted || !(columnId in row.data)) {
        continue;
      }
      const value = row.data[columnId];
      if (value === undefined) {
        continue;
      }
      if (convertValue(value, type, nextType, toSettings).cleared) {
        count += 1;
      }
    }
    return count;
  }

  function usage(optionId: string): number {
    let count = 0;
    for (const row of Object.values(store.getState().rows)) {
      const cell = row.data[columnId];
      if (row.deleted) {
        continue;
      }
      if (cell === optionId || (Array.isArray(cell) && cell.includes(optionId))) {
        count += 1;
      }
    }
    return count;
  }

  return (
    <>
      <Menu open={open} x={x} y={y} label={`Column menu for ${name}`} onClose={closeAll}>
        {canManage ? (
          <>
            <MenuItem
              label="Rename"
              onSelect={() => {
                closeAll();
                onRename();
              }}
            />
            <MenuItem label="Change type" onSelect={() => setTypesOpen(true)} />
            {type === "status" || type === "dropdown" ? (
              <MenuItem
                label="Edit labels"
                onSelect={() => {
                  closeAll();
                  setLabelsOpen(true);
                }}
              />
            ) : null}
            {type === "due_date" ? (
              <MenuItem
                label="Remind when due"
                checked={settings.remind === true}
                onSelect={() => {
                  onCommit("column.update", { columnId, patch: { settings: { remind: settings.remind !== true } } });
                  closeAll();
                }}
              />
            ) : null}
            {type === "person" ? (
              <MenuItem
                label="Allow multiple people"
                checked={multiple}
                onSelect={() => {
                  onCommit("column.update", { columnId, patch: { settings: { multiple: !multiple } } });
                  closeAll();
                }}
              />
            ) : null}
            <MenuItem
              label="Insert left"
              onSelect={() => {
                onCommit("column.insert", insertPayload(store.getState(), columnId, "left", direction));
                closeAll();
              }}
            />
            <MenuItem
              label="Insert right"
              onSelect={() => {
                onCommit("column.insert", insertPayload(store.getState(), columnId, "right", direction));
                closeAll();
              }}
            />
            <MenuItem
              label="Move left"
              disabled={atLeft}
              title={atLeft ? "This column is already at the edge" : undefined}
              onSelect={() => {
                const payload = movePayload(store.getState(), columnId, "left", direction);
                if (payload) {
                  onCommit("column.move", payload);
                }
                closeAll();
              }}
            />
            <MenuItem
              label="Move right"
              disabled={atRight}
              title={atRight ? "This column is already at the edge" : undefined}
              onSelect={() => {
                const payload = movePayload(store.getState(), columnId, "right", direction);
                if (payload) {
                  onCommit("column.move", payload);
                }
                closeAll();
              }}
            />
          </>
        ) : null}
        {canStyle || canManage ? (
          <>
            <MenuItem label="Header color" onSelect={() => setFillOpen("header")} />
            <MenuItem label="Cell color" onSelect={() => setFillOpen("cells")} />
          </>
        ) : null}
        {protection.canManage ? (
          <MenuItem
            label={isProtected ? "Protection…" : "Protect column…"}
            onSelect={() => {
              closeAll();
              setProtectOpen(true);
            }}
          />
        ) : null}
        {canDelete ? (
          <MenuItem
            label="Delete column"
            danger
            onSelect={() => {
              closeAll();
              setDeleteOpen(true);
            }}
          />
        ) : null}
      </Menu>
      <Menu
        open={open && fillOpen !== null}
        x={x + 220}
        y={y + 72}
        label={fillOpen === "header" ? `Header color for ${name}` : `Cell color for ${name}`}
        onClose={() => setFillOpen(null)}
      >
        <ColumnFillPicker
          value={fillOpen === "header" ? headerColor : fillColor}
          label={fillOpen === "header" ? "Header color" : "Cell color"}
          onChange={(color) => {
            const key = fillOpen === "header" ? "headerColor" : "fillColor";
            onCommit("column.update", { columnId, patch: { settings: { [key]: color } } });
            closeAll();
          }}
          onClear={() => {
            const key = fillOpen === "header" ? "headerColor" : "fillColor";
            onCommit("column.update", { columnId, patch: { settings: { [key]: null } } });
            closeAll();
          }}
        />
      </Menu>
      {protectOpen ? (
        <ProtectDialog
          sheetId={store.getState().sheet.id}
          scope="column"
          targetId={columnId}
          targetName={name}
          onClose={() => setProtectOpen(false)}
        />
      ) : null}
      <Menu open={open && typesOpen} x={x + 220} y={y + 36} label={`Change type for ${name}`} onClose={() => setTypesOpen(false)}>
        {COLUMN_TYPE_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <MenuItem
              key={option.type}
              label={option.label}
              disabled={option.type === type}
              icon={<Icon className="size-3.5 text-muted" aria-hidden="true" />}
              onSelect={() => {
                setPendingType({ type: option.type, cleared: clearedFor(option.type) });
                setTypesOpen(false);
                onClose();
              }}
            />
          );
        })}
      </Menu>
      <ConfirmDialog
        open={pendingType !== null}
        title={`Change ${name} to ${pendingType ? labelFor(pendingType.type) : ""}`}
        confirmLabel="Change column type"
        onClose={() => setPendingType(null)}
        onConfirm={() => {
          if (pendingType) {
            onCommit("column.update", { columnId, patch: { type: pendingType.type } });
          }
          setPendingType(null);
        }}
        message={
          <>
            <span className="block">Existing values will be converted. Values that can&apos;t be converted will be cleared.</span>
            <span className="mt-1 block">
              {pendingType?.cleared ?? 0} {(pendingType?.cleared ?? 0) === 1 ? "value" : "values"} will be cleared.
            </span>
          </>
        }
      />
      <StatusOptionsEditor
        open={labelsOpen}
        name={name}
        options={readStatusOptions(settings)}
        usage={usage}
        onClose={() => setLabelsOpen(false)}
        onSave={(options) => {
          onCommit("column.update", {
            columnId,
            patch: { settings: { options } },
          });
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        title={`Delete ${name}`}
        message={`Delete column ${name}? This removes it for everyone.`}
        confirmLabel="Delete column"
        danger
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          onCommit("column.delete", { columnId });
          onOfferUndo("Column deleted", () => {
            onCommit("column.restore", { columnId });
          });
          setDeleteOpen(false);
        }}
      />
    </>
  );
}

export function labelFor(type: ColumnType): string {
  return COLUMN_TYPE_OPTIONS.find((option) => option.type === type)?.label ?? type;
}

export function nameForNewColumn(type: ColumnType, existingNames: readonly string[]): string {
  const base = labelFor(type);
  const taken = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) {
    return base;
  }
  let number = 2;
  while (taken.has(`${base} ${number}`.toLowerCase())) {
    number += 1;
  }
  return `${base} ${number}`;
}

function readStatusOptions(settings: Record<string, JsonValue>): StatusDraft[] {
  const options = settings.options;
  if (!Array.isArray(options)) {
    return [];
  }
  return options.flatMap((option) => {
    if (!option || typeof option !== "object" || Array.isArray(option)) {
      return [];
    }
    const id = option.id;
    const label = option.label;
    const color = option.color;
    if (typeof id !== "string" || typeof label !== "string" || typeof color !== "string") {
      return [];
    }
    return [{ id, label, color }];
  });
}

function insertPayload(
  state: ReturnType<ReturnType<typeof useSheetStore>["getState"]>,
  columnId: string,
  side: "left" | "right",
  direction: "ltr" | "rtl",
): SheetOp["payload"] {
  const ids = state.columnOrder;
  const index = ids.indexOf(columnId);
  const after = direction === "rtl" ? side === "left" : side === "right";
  const at = after ? index + 1 : index;
  const prev = ids[at - 1];
  const next = ids[at];
  return {
    columnId: crypto.randomUUID(),
    name: nameForNewColumn("text", ids.map((id) => state.columns[id]?.name ?? "")),
    type: "text",
    position: generateKeyBetween(prev ? state.columns[prev]?.position ?? null : null, next ? state.columns[next]?.position ?? null : null),
  };
}

function movePayload(
  state: ReturnType<ReturnType<typeof useSheetStore>["getState"]>,
  columnId: string,
  side: "left" | "right",
  direction: "ltr" | "rtl",
): SheetOp["payload"] | null {
  const ids = state.columnOrder;
  const index = ids.indexOf(columnId);
  const delta = direction === "rtl" ? (side === "left" ? 1 : -1) : side === "left" ? -1 : 1;
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ids.length) {
    return null;
  }
  const nextOrder = ids.slice();
  nextOrder.splice(index, 1);
  nextOrder.splice(target, 0, columnId);
  const prev = nextOrder[target - 1];
  const next = nextOrder[target + 1];
  return {
    columnId,
    position: generateKeyBetween(prev ? state.columns[prev]?.position ?? null : null, next ? state.columns[next]?.position ?? null : null),
  };
}
