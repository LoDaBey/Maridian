import { useState } from "react";

const ACCEPT = [
  ".csv",
  ".xlsx",
  ".xlsm",
  ".xls",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");

export function ImportFilePicker({
  disabled,
  fileLabel,
  onFile,
}: {
  disabled?: boolean;
  fileLabel: string;
  onFile: (file: File) => void;
}) {
  const [over, setOver] = useState(false);

  function takeFile(file: File | undefined) {
    if (file) {
      onFile(file);
    }
  }

  return (
    <label
      className={`flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center ${
        over ? "border-primary bg-primary/5" : "border-border"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        takeFile(event.dataTransfer.files[0]);
      }}
    >
      <span className="font-medium">Choose Excel or CSV</span>
      <span className="mt-1 text-xs text-muted">.xlsx, .xls, or .csv — up to 5 MB and 10 000 rows</span>
      {fileLabel ? <span className="mt-2 text-xs">{fileLabel}</span> : null}
      <input
        aria-label="Spreadsheet file"
        type="file"
        accept={ACCEPT}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          takeFile(file);
        }}
      />
    </label>
  );
}
