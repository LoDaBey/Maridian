"use client";

import type { JsonValue } from "@/lib/sheets/ops";
import type { DirectoryUser } from "@/components/grid/types";
import type { LocalColumn, LocalRow } from "@/lib/sheets/apply-local";
import type { StatusOption } from "@/lib/sheets/values";
import { ItemFieldRow } from "./ItemFieldRow";

export function ItemFields({
  row,
  columns,
  users,
  readOnly,
  onCommit,
  onInvalid,
  onAddOption,
}: {
  row: LocalRow;
  columns: LocalColumn[];
  users: DirectoryUser[];
  readOnly: boolean;
  onCommit: (columnId: string, value: JsonValue | null) => void;
  onInvalid: (message: string) => void;
  onAddOption: (columnId: string, options: StatusOption[]) => void;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {columns.map((column) => (
        <ItemFieldRow
          key={column.id}
          column={column}
          row={row}
          users={users}
          readOnly={readOnly}
          onCommit={onCommit}
          onInvalid={onInvalid}
          onAddOption={onAddOption}
        />
      ))}
    </div>
  );
}
