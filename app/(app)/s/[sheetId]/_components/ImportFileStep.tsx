import type { ImportSheetSummary } from "@/lib/db-types";
import { ImportFilePicker } from "./ImportFilePicker";

export function ImportFileStep({
  disabled,
  fileLabel,
  sheets,
  importAllSheets,
  activeSheet,
  onFile,
  onSheetChange,
}: {
  disabled?: boolean;
  fileLabel: string;
  sheets: ImportSheetSummary[];
  importAllSheets: boolean;
  activeSheet: string;
  onFile: (file: File) => void;
  onSheetChange: (name: string) => void;
}) {
  const totalRows = sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0);
  const countLabel = new Intl.NumberFormat("en-US").format(totalRows).replace(/,/g, " ");

  return (
    <div className="mt-4 flex flex-col gap-3">
      <ImportFilePicker disabled={disabled} fileLabel="" onFile={onFile} />
      {fileLabel ? (
        <p className="text-sm text-text">
          {fileLabel}
          {sheets.length > 0
            ? ` · ${sheets.length} sheet${sheets.length === 1 ? "" : "s"}, ${countLabel} rows`
            : null}
        </p>
      ) : null}
      {sheets.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-text">
            {importAllSheets && sheets.length > 1
              ? "Workbook sheets (all will be imported)"
              : sheets.length > 1
                ? "Workbook sheet"
                : "Sheet"}
          </p>
          {importAllSheets || sheets.length === 1 ? (
            <ul className="flex flex-col gap-1 rounded-lg border border-border bg-bg p-2">
              {sheets.map((sheet) => (
                <li
                  key={sheet.name}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm text-text"
                >
                  <span className="truncate font-medium">{sheet.name}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {sheet.rowCount} rows · {sheet.columnCount} columns
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <label className="flex flex-col gap-1 text-sm text-text">
              Choose which sheet to append
              <select
                aria-label="Workbook sheet"
                value={activeSheet}
                onChange={(event) => onSheetChange(event.target.value)}
                className="rounded-lg border border-border bg-surface px-2 py-1.5 text-text outline-none"
              >
                {sheets.map((sheet) => (
                  <option key={sheet.name} value={sheet.name}>
                    {sheet.name} ({sheet.rowCount} rows, {sheet.columnCount} columns)
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      ) : null}
    </div>
  );
}
