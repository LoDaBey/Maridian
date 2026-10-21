"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useSheetDispatch } from "@/lib/realtime/sheet-session";
import type { StatusOption } from "@/lib/sheets/values";
import { useColumns, useRow } from "@/stores/sheet-store";
import { useDirectory } from "@/components/grid/useDirectory";
import { useMe, canDo } from "@/components/grid/MeContext";
import { can } from "@/lib/rbac";
import type { JsonValue } from "@/lib/sheets/ops";
import { ItemActivity } from "./ItemActivity";
import { ItemFields } from "./ItemFields";
import { ItemTitle } from "./ItemTitle";
import { ItemUpdates } from "./ItemUpdates";

type ItemTab = "fields" | "updates" | "activity";

export function ItemCard({
  sheetId,
  rowId,
  onClose,
  onCommit,
  onInvalid,
}: {
  sheetId: string;
  rowId: string;
  onClose: () => void;
  onCommit: (rowId: string, columnId: string, value: JsonValue | null) => void;
  onInvalid: (message: string) => void;
}) {
  const row = useRow(rowId);
  const columns = useColumns();
  const dispatch = useSheetDispatch();
  const { users } = useDirectory();
  const me = useMe();
  const [tab, setTab] = useState<ItemTab>("fields");
  const readOnly = !canDo(me, "cell.edit");
  const titleColumn = columns.find((column) => column.type === "text");
  const title = titleColumn ? String(row?.data[titleColumn.id] ?? "") : "";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!row) {
    return null;
  }

  return (
    <motion.div className="fixed inset-0 z-40">
      <motion.button
        type="button"
        aria-label="Close item"
        className="absolute inset-0 cursor-pointer bg-black/50"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        onClick={onClose}
      />
      <motion.aside
        className="absolute inset-y-0 end-0 flex h-full w-full max-w-xl flex-col bg-surface shadow-xl"
        role="dialog"
        aria-label={title || "Item"}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 420, damping: 36 }}
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <ItemTitle
            value={title}
            fallback={`Item #${row.itemNumber}`}
            readOnly={readOnly || !titleColumn}
            onCommit={(value) => {
              if (titleColumn) {
                onCommit(rowId, titleColumn.id, value);
              }
            }}
          />
          <button
            type="button"
            aria-label="Close item"
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-gray-100"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>
        <div className="flex gap-1 border-b border-border px-3">
          {(
            [
              ["fields", "Fields"],
              ["updates", "Updates"],
              ["activity", "Activity"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-label={label}
              className={`cursor-pointer rounded-lg px-3 py-2 text-sm ${tab === id ? "font-semibold text-primary" : "text-muted"}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {tab === "fields" ? (
            <ItemFields
              row={row}
              columns={columns}
              users={users}
              readOnly={readOnly}
              onCommit={(columnId, value) => onCommit(rowId, columnId, value)}
              onInvalid={onInvalid}
              onAddOption={(columnId, options: StatusOption[]) => {
                dispatch("column.update", { columnId, patch: { settings: { options } } });
              }}
            />
          ) : null}
          {tab === "updates" ? (
            <ItemUpdates sheetId={sheetId} rowId={rowId} meId={me.id} users={users} readOnly={!can(me.role, "row.insert")} />
          ) : null}
          {tab === "activity" ? <ItemActivity sheetId={sheetId} rowId={rowId} /> : null}
        </div>
      </motion.aside>
    </motion.div>
  );
}
