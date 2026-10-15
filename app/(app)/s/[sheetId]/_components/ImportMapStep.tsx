import { COLUMN_TYPE_OPTIONS } from "@/components/grid/ColumnMenu";
import type { ColumnType } from "@/lib/db-types";
import type { ColumnChoice, SheetColumnRef } from "@/lib/sheets/csv";

export function ImportMapStep({
  createOnly,
  askName = true,
  target,
  newName,
  choices,
  rows,
  columns,
  sheetNames = [],
  activeSheet = "",
  onNameChange,
  onTargetChange,
  onColumnChange,
  onTypeChange,
  onSheetChange,
}: {
  createOnly: boolean;
  askName?: boolean;
  target: "append" | "new";
  newName: string;
  choices: ColumnChoice[];
  rows: string[][];
  columns: SheetColumnRef[];
  sheetNames?: string[];
  activeSheet?: string;
  onNameChange: (name: string) => void;
  onTargetChange: (target: "append" | "new") => void;
  onColumnChange: (index: number, value: string) => void;
  onTypeChange: (index: number, type: ColumnType) => void;
  onSheetChange?: (name: string) => void;
}) {
  const showName = askName && target === "new";
  const showTabs = sheetNames.length > 1 && Boolean(onSheetChange);
  const showTargetRow = !createOnly || showName;

  return (
    <div className="mt-4 flex min-h-0 flex-col gap-3">
      {showTabs ? (
        <div className="flex flex-wrap gap-1 border-b border-border pb-2">
          {sheetNames.map((name) => {
            const selected = name === activeSheet;
            return (
              <button
                key={name}
                type="button"
                aria-label={`Map columns for ${name}`}
                aria-pressed={selected}
                className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm outline-none ${
                  selected ? "bg-primary text-white" : "bg-bg text-text hover:bg-row"
                }`}
                onClick={() => onSheetChange?.(name)}
              >
                {name}
              </button>
            );
          })}
        </div>
      ) : null}
      {showTargetRow ? (
        <div className="flex flex-wrap items-end gap-4">
          {createOnly ? null : (
            <fieldset className="flex gap-3">
              <legend className="mb-1 font-medium text-text">Target</legend>
              <label className="inline-flex items-center gap-1 text-text">
                <input
                  type="radio"
                  name="import-target"
                  className="rounded outline-none"
                  checked={target === "append"}
                  onChange={() => onTargetChange("append")}
                />
                This sheet
              </label>
              <label className="inline-flex items-center gap-1 text-text">
                <input
                  type="radio"
                  name="import-target"
                  className="rounded outline-none"
                  checked={target === "new"}
                  onChange={() => onTargetChange("new")}
                />
                New sheet
              </label>
            </fieldset>
          )}
          {showName ? (
            <label className="flex flex-col gap-1 text-text">
              Name
              <input
                aria-label="New sheet name"
                value={newName}
                maxLength={100}
                onChange={(event) => onNameChange(event.target.value)}
                className="rounded-lg border border-border bg-surface px-2 py-1 text-text outline-none"
              />
            </label>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 overflow-auto">
        <table className="w-full border-collapse text-start text-text">
          <thead>
            <tr className="text-xs text-muted">
              <th className="px-2 py-1 text-start font-medium">Source column</th>
              <th className="px-2 py-1 text-start font-medium">Sample</th>
              <th className="px-2 py-1 text-start font-medium">Map to</th>
              <th className="px-2 py-1 text-start font-medium">Type</th>
            </tr>
          </thead>
          <tbody>
            {choices.map((choice, index) => (
              <tr key={`${choice.header}-${index}`} className="border-t border-border">
                <td className="px-2 py-1">{choice.header}</td>
                <td className="max-w-48 truncate px-2 py-1 text-muted">{rows[0]?.[index] ?? ""}</td>
                <td className="px-2 py-1">
                  <select
                    aria-label={`Column for ${choice.header}`}
                    value={choice.kind === "existing" ? `existing:${choice.columnId}` : choice.kind}
                    onChange={(event) => onColumnChange(index, event.target.value)}
                    className="rounded-lg border border-border bg-surface px-2 py-1 text-text outline-none"
                  >
                    <option value="skip">Skip</option>
                    {target === "append"
                      ? columns.map((column) => (
                          <option key={column.id} value={`existing:${column.id}`}>
                            {column.name}
                          </option>
                        ))
                      : null}
                    <option value="new">New column</option>
                  </select>
                </td>
                <td className="px-2 py-1">
                  {choice.kind === "new" ? (
                    <select
                      aria-label={`Type for ${choice.header}`}
                      value={choice.type}
                      onChange={(event) => onTypeChange(index, event.target.value as ColumnType)}
                      className="rounded-lg border border-border bg-surface px-2 py-1 text-text outline-none"
                    >
                      {COLUMN_TYPE_OPTIONS.map((option) => (
                        <option key={option.type} value={option.type}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-muted">{choice.kind === "skip" ? "" : typeLabel(choice.type)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function typeLabel(type: ColumnType): string {
  return COLUMN_TYPE_OPTIONS.find((option) => option.type === type)?.label ?? type;
}
