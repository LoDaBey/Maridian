import type { ImportPlan } from "@/lib/sheets/csv";

export function ImportPreviewStep({
  plan,
  plans = [],
  sheetNames = [],
  activeSheet = "",
  progress,
  onSheetChange,
}: {
  plan: ImportPlan;
  plans?: ImportPlan[];
  sheetNames?: string[];
  activeSheet?: string;
  progress: string;
  onSheetChange?: (name: string) => void;
}) {
  const multi = plans.length > 1 && sheetNames.length > 1;
  const totalRows = multi ? plans.reduce((sum, item) => sum + item.totalRows, 0) : plan.totalRows;
  const countLabel = new Intl.NumberFormat("en-US").format(totalRows).replace(/,/g, " ");

  return (
    <div className="mt-4 flex min-h-0 flex-col gap-3 text-text">
      {multi ? (
        <>
          <p>
            Importing {plans.length} sheets · {countLabel} rows total.
          </p>
          <ul className="flex flex-col gap-1 rounded-lg border border-border bg-bg p-2 text-sm">
            {plans.map((item, index) => (
              <li key={sheetNames[index] ?? index} className="flex justify-between gap-3 px-2 py-1">
                <span className="truncate font-medium">{sheetNames[index] ?? `Tab ${index + 1}`}</span>
                <span className="shrink-0 text-xs text-muted">{item.summary}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1 border-b border-border pb-2">
            {sheetNames.map((name) => {
              const selected = name === activeSheet;
              return (
                <button
                  key={name}
                  type="button"
                  aria-label={`Preview ${name}`}
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
        </>
      ) : (
        <p>{plan.summary}</p>
      )}
      {plan.unmatchedPeople.length > 0 ? <p>Unmatched people: {plan.unmatchedPeople.join(", ")}</p> : null}
      {progress ? <p role="status">{progress}</p> : null}
      <div className="min-h-0 overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-xs text-muted">
              {plan.columns.map((column) => (
                <th key={column.columnId} className="px-2 py-1 text-start font-medium">
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.preview.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-border">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={`max-w-48 truncate px-2 py-1 ${cell.invalid ? "bg-danger/15 text-danger" : ""}`}>
                    {cell.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
