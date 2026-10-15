"use client";

import type { FileAttachment } from "@/lib/db-types";
import { fileHref } from "@/lib/sheets/column-meta";

export function FileLinkRow({
  file,
  onRemove,
}: {
  file: FileAttachment;
  onRemove?: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-2 text-[13px]">
      <a
        href={fileHref(file)}
        target="_blank"
        rel="noreferrer"
        className="truncate text-primary"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {file.name}
      </a>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${file.name}`}
          className="cursor-pointer rounded-lg px-1 text-xs text-muted"
          onClick={onRemove}
        >
          Remove
        </button>
      ) : null}
    </li>
  );
}
