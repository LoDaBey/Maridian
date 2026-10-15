"use client";

import { Star } from "lucide-react";
import type { DueTone } from "@/lib/db-types";
import type { JsonValue } from "@/lib/sheets/ops";
import type { LocalColumn } from "@/lib/sheets/apply-local";
import { asFileList, asStringList, fileHref, tagColorFor } from "@/lib/sheets/column-meta";
import { TimelineBar } from "./TimelineBar";
import { countryByCode, countryName } from "@/lib/sheets/countries";
import { CountryFlag } from "../CountryFlag";
import type { DirectoryUser } from "../types";

export function CellValue({
  column,
  value,
  users,
  dueTone = null,
  centered = true,
}: {
  column: LocalColumn;
  value: JsonValue | undefined;
  users: DirectoryUser[];
  dueTone?: DueTone;
  centered?: boolean;
}) {
  const rowAlign = centered ? "justify-center text-center" : "justify-start text-start";
  if (column.type === "checkbox") {
    return (
      <span className="flex h-full items-center justify-center">
        <span
          className={`size-3.5 rounded border border-border ${value === true ? "bg-primary" : "bg-surface"}`}
          aria-hidden="true"
        />
      </span>
    );
  }

  if (column.type === "status" || column.type === "priority") {
    const option = statusOption(column, value);
    if (!option) {
      return <span className="absolute inset-1 rounded bg-track" aria-hidden="true" />;
    }
    return (
      <span
        className="absolute inset-1 flex items-center justify-center truncate rounded px-2 text-[13px] font-medium text-white"
        style={{ backgroundColor: option.color }}
        title={option.label}
      >
        {option.label}
      </span>
    );
  }

  if (column.type === "dropdown") {
    const selected = asStringList(value)
      .map((id) => statusOption(column, id))
      .filter((option): option is NonNullable<typeof option> => option !== null);
    if (selected.length === 0) {
      return null;
    }
    return (
      <span className={`flex h-full w-full items-center gap-1 overflow-hidden px-2 ${rowAlign}`}>
        {selected.slice(0, 2).map((option) => (
          <span
            key={option.id}
            className="truncate rounded-full px-2 py-0.5 text-[12px] font-medium text-white"
            style={{ backgroundColor: option.color }}
          >
            {option.label}
          </span>
        ))}
        {selected.length > 2 ? <span className="text-muted">+{selected.length - 2}</span> : null}
      </span>
    );
  }

  if (column.type === "tags") {
    const tags = asStringList(value);
    if (tags.length === 0) {
      return null;
    }
    return (
      <span className={`flex h-full w-full items-center gap-1 overflow-hidden px-1 ${rowAlign}`}>
        {tags.slice(0, 2).map((tag) => (
          <span key={tag} className="truncate rounded-full px-2 py-0.5 text-[12px] font-medium" style={{ backgroundColor: tagColorFor(tag) }}>
            {tag}
          </span>
        ))}
        {tags.length > 2 ? <span className="text-muted">+{tags.length - 2}</span> : null}
      </span>
    );
  }

  if (column.type === "country" && typeof value === "string") {
    const country = countryByCode(value);
    if (!country) {
      return null;
    }
    return (
      <span className={`flex h-full w-full items-center gap-1 px-2 ${rowAlign}`} title={country.name}>
        <CountryFlag code={country.code} />
        <span className="truncate">{countryName(country, true)}</span>
      </span>
    );
  }

  if (column.type === "rating" && typeof value === "number") {
    return (
      <span className={`flex h-full w-full items-center gap-0.5 px-2 ${rowAlign}`} title={`${value} of 5`}>
        {[1, 2, 3, 4, 5].map((score) => (
          <Star
            key={score}
            className={`size-3.5 ${score <= value ? "fill-amber-400 text-amber-400" : "text-muted"}`}
            aria-hidden="true"
          />
        ))}
      </span>
    );
  }

  if (column.type === "timeline") {
    return <TimelineBar column={column} value={value} />;
  }

  if (column.type === "files") {
    const files = asFileList(value);
    if (files.length === 0) {
      return null;
    }
    const first = files[0];
    return (
      <span className={`flex h-full w-full items-center gap-1 px-2 ${rowAlign}`}>
        {first ? (
          <a
            href={fileHref(first)}
            target="_blank"
            rel="noreferrer"
            className="truncate text-primary"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            {first.name}
          </a>
        ) : null}
        {files.length > 1 ? <span className="text-muted">+{files.length - 1}</span> : null}
      </span>
    );
  }

  if (column.type === "due_date" && typeof value === "string") {
    const tone =
      dueTone === "overdue" ? "bg-red-100 text-red-700" : dueTone === "today" ? "bg-amber-100 text-amber-800" : "";
    return (
      <span className={`block truncate px-2 leading-10 ${rowAlign} ${tone}`} title={formatDate(value)}>
        {formatDate(value)}
      </span>
    );
  }

  if (column.type === "person") {
    const people = peopleFor(value, users);
    if (people.length === 0) {
      return null;
    }
    const shown = people.slice(0, 3);
    const extra = people.length - shown.length;
    return (
      <span dir="auto" className={`flex h-full w-full items-center px-2 ${rowAlign}`} title={people.map((person) => person.fullName).join(", ")}>
        <span className="flex items-center">
          {shown.map((person, index) => (
            <span
              key={person.id}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-white ring-2 ring-row"
              style={{ backgroundColor: person.avatarColor, marginInlineStart: index === 0 ? 0 : -8 }}
            >
              {initials(person.fullName)}
            </span>
          ))}
        </span>
        {extra > 0 ? <span className="ms-1 text-xs text-muted">+{extra}</span> : null}
      </span>
    );
  }

  if (column.type === "link") {
    const link = asLink(value);
    if (!link) {
      return null;
    }
    const label = link.label || linkLabel(link.url);
    return (
      <span dir="auto" className={`flex h-full w-full items-center px-2 ${rowAlign}`} title={link.url}>
        <button
          type="button"
          aria-label={`Open ${label}`}
          className="cursor-pointer truncate rounded text-primary hover:underline"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            window.open(link.url, "_blank", "noopener,noreferrer");
          }}
        >
          {label}
        </button>
      </span>
    );
  }

  const text = displayText(column, value);
  if (!text) {
    return null;
  }
  return (
    <span dir="auto" className={`block w-full truncate px-2 leading-10 ${rowAlign}`} title={text}>
      {column.type === "long_text" ? text.split("\n")[0] : text}
    </span>
  );
}

export function displayText(column: LocalColumn, value: JsonValue | undefined): string {
  if (value === undefined) {
    return "";
  }
  if (column.type === "number" && typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat("en-US").format(value);
  }
  if ((column.type === "date" || column.type === "due_date") && typeof value === "string") {
    return formatDate(value);
  }
  if (column.type === "checkbox") {
    return value === true ? "true" : value === false ? "false" : "";
  }
  if (column.type === "status") {
    return statusOption(column, value)?.label ?? (typeof value === "string" ? value : "");
  }
  if (column.type === "link") {
    const link = asLink(value);
    return link ? link.label || linkLabel(link.url) : "";
  }
  if (column.type === "person") {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string").join(", ") : "";
  }
  return typeof value === "string" ? value : "";
}

function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return iso;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusOption(column: LocalColumn, value: JsonValue | undefined): { id: string; label: string; color: string } | null {
  if (typeof value !== "string") {
    return null;
  }
  const options = column.settings.options;
  if (!Array.isArray(options)) {
    return null;
  }
  for (const option of options) {
    if (!option || typeof option !== "object" || Array.isArray(option)) {
      continue;
    }
    if (option.id === value && typeof option.label === "string" && typeof option.color === "string") {
      return { id: value, label: option.label, color: option.color };
    }
  }
  return null;
}

function asLink(value: JsonValue | undefined): { url: string; label?: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.url !== "string") {
    return null;
  }
  const label = typeof value.label === "string" && value.label ? value.label : undefined;
  return { url: value.url, label };
}

function linkLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

function peopleFor(value: JsonValue | undefined, users: DirectoryUser[]): DirectoryUser[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const byId = new Map(users.map((user) => [user.id, user]));
  return value
    .filter((item): item is string => typeof item === "string")
    .map((id) => byId.get(id) ?? { id, fullName: id, email: "", avatarColor: "#676879", isActive: true });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0] ?? "").join("").toUpperCase() || "?";
}
