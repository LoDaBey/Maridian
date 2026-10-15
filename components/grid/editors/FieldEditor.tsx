"use client";

import type { JsonValue } from "@/lib/sheets/ops";
import type { LocalColumn } from "@/lib/sheets/apply-local";
import type { StatusOption } from "@/lib/sheets/values";
import type { DirectoryUser } from "../types";
import { CountryEditor } from "./CountryEditor";
import { DateEditor } from "./DateEditor";
import { DropdownEditor } from "./DropdownEditor";
import { FilesEditor } from "./FilesEditor";
import { LinkEditor } from "./LinkEditor";
import { LongTextEditor } from "./LongTextEditor";
import { PersonEditor } from "./PersonEditor";
import { RatingEditor } from "./RatingEditor";
import { StatusEditor } from "./StatusEditor";
import { TagsEditor } from "./TagsEditor";
import { TextEditor } from "./TextEditor";
import { TimelineEditor } from "./TimelineEditor";

export function FieldEditor({
  column,
  value,
  seed,
  users,
  onCommit,
  onCancel,
  onInvalid,
  onAddOption,
}: {
  column: LocalColumn;
  value: JsonValue | undefined;
  seed?: string | null;
  users: DirectoryUser[];
  onCommit: (value: JsonValue | null, move: "down" | "next" | "none") => void;
  onCancel: () => void;
  onInvalid: (message: string) => void;
  onAddOption: (options: StatusOption[]) => void;
}) {
  if (column.type === "long_text") {
    return (
      <LongTextEditor column={column} value={value} seed={seed ?? null} onCommit={onCommit} onCancel={onCancel} onInvalid={onInvalid} />
    );
  }
  if (column.type === "link") {
    return <LinkEditor column={column} value={value} onCommit={onCommit} onCancel={onCancel} onInvalid={onInvalid} />;
  }
  if (column.type === "date" || column.type === "due_date") {
    return <DateEditor column={column} value={value} onCommit={onCommit} onCancel={onCancel} />;
  }
  if (column.type === "status" || column.type === "priority") {
    return <StatusEditor column={column} onCommit={onCommit} onCancel={onCancel} onAddOption={onAddOption} onInvalid={onInvalid} />;
  }
  if (column.type === "dropdown") {
    return (
      <DropdownEditor
        column={column}
        value={value}
        onCommit={onCommit}
        onCancel={onCancel}
        onAddOption={onAddOption}
        onInvalid={onInvalid}
      />
    );
  }
  if (column.type === "person") {
    return <PersonEditor column={column} value={value} users={users} onCommit={onCommit} onCancel={onCancel} />;
  }
  if (column.type === "timeline") {
    return <TimelineEditor column={column} value={value} onCommit={onCommit} onCancel={onCancel} />;
  }
  if (column.type === "tags") {
    return <TagsEditor column={column} value={value} onCommit={onCommit} onCancel={onCancel} />;
  }
  if (column.type === "country") {
    return <CountryEditor column={column} value={value} onCommit={onCommit} onCancel={onCancel} />;
  }
  if (column.type === "rating") {
    return <RatingEditor column={column} value={value} onCommit={onCommit} onCancel={onCancel} />;
  }
  if (column.type === "files") {
    return <FilesEditor column={column} value={value} onCommit={onCommit} onCancel={onCancel} />;
  }
  return (
    <TextEditor
      column={column}
      value={value}
      seed={seed ?? null}
      centered
      onCommit={onCommit}
      onCancel={onCancel}
      onInvalid={onInvalid}
    />
  );
}
