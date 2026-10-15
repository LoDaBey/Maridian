"use client";

import type { JsonValue } from "@/lib/sheets/ops";
import type { LocalColumn } from "@/lib/sheets/apply-local";
import { asFileList, FILE_MAX_COUNT } from "@/lib/sheets/column-meta";
import { AddFileLink } from "@/components/files/AddFileLink";
import { FileLinkRow } from "@/components/files/FileLinkRow";

export function FilesEditor({
  column,
  value,
  onCommit,
  onCancel,
}: {
  column: LocalColumn;
  value: JsonValue | undefined;
  onCommit: (value: JsonValue | null, move: "down" | "next" | "none") => void;
  onCancel: () => void;
}) {
  const files = asFileList(value);
  const full = files.length >= FILE_MAX_COUNT;

  function commitNext(next: typeof files): void {
    onCommit(
      next.length ? next.map((file) => ({ id: file.id, name: file.name, url: file.url })) : null,
      "none",
    );
  }

  return (
    <div
      className="absolute start-0 top-full z-30 w-72 rounded-lg border border-border bg-surface p-2 shadow"
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <ul className="mb-2 flex flex-col gap-1">
        {files.map((file) => (
          <FileLinkRow
            key={file.id}
            file={file}
            onRemove={() => commitNext(files.filter((item) => item.id !== file.id))}
          />
        ))}
      </ul>
      {full ? (
        <p className="text-xs text-muted">A cell can have {FILE_MAX_COUNT} files.</p>
      ) : (
        <AddFileLink
          addAriaLabel={`Add file link to ${column.name}`}
          onAdd={(file) => commitNext([...files, file])}
        />
      )}
    </div>
  );
}
