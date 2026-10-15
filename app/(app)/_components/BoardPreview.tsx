import type { SheetPreview } from "@/lib/db-types";

export function BoardPreview({ preview }: { preview?: SheetPreview }) {
  const columns = preview?.columns ?? [];
  const rows = preview?.rows ?? [];
  if (columns.length === 0 || rows.length === 0) {
    return (
      <div className="flex h-36 items-center bg-bg px-5" aria-hidden="true">
        <p className="text-xs text-muted">No items yet</p>
      </div>
    );
  }

  return (
    <div dir={preview?.direction ?? "ltr"} className="flex h-36 flex-col gap-1.5 bg-bg px-3 py-2.5" aria-hidden="true">
      <div className="flex items-center gap-1.5 ps-2.5 text-[10px] text-muted">
        {columns.map((column, index) => (
          <span key={`${column}-${index}`} className={index === 0 ? "min-w-0 flex-1 truncate" : "w-16 shrink-0 truncate text-center"}>
            {column}
          </span>
        ))}
      </div>
      {rows.map((row, rowIndex) => (
        <div key={`${row.color}-${rowIndex}`} className="flex h-6 items-center gap-1.5">
          <span className="h-full w-1 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
          {row.cells.map((cell, index) =>
            index === 0 ? (
              <span key={`${rowIndex}-${index}`} className="flex h-full min-w-0 flex-1 items-center truncate rounded bg-row px-1.5 text-[11px] text-text">
                {cell.text}
              </span>
            ) : (
              <span
                key={`${rowIndex}-${index}`}
                className={`flex h-full w-16 shrink-0 items-center justify-center truncate rounded px-1 text-[10px] font-medium ${cell.pill && cell.color ? "text-white" : "bg-row text-muted"}`}
                style={cell.pill ? { backgroundColor: cell.color ?? undefined } : undefined}
              >
                {cell.text}
              </span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
