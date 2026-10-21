import {
  indexPeople,
  mapPerson,
  normalizeName,
  parseDate,
  readOptions,
  type ImportPerson,
  type PlannedColumn,
} from "@/lib/sheets/csv";
import type { JsonValue } from "@/lib/sheets/ops";
import { normalizeValue, type ValueColumn } from "@/lib/sheets/values";

const SHORT_MONTHS: Record<string, string> = {
  jan: "January",
  feb: "February",
  mar: "March",
  apr: "April",
  may: "May",
  jun: "June",
  jul: "July",
  aug: "August",
  sep: "September",
  sept: "September",
  oct: "October",
  nov: "November",
  dec: "December",
};

export function textToCellValue(
  column: ValueColumn,
  text: string,
  usersById: ReadonlyMap<string, string>,
): { ok: true; value: JsonValue | undefined } | { ok: false } {
  if (!text.trim()) {
    return checked(column, "");
  }
  switch (column.type) {
    case "status":
    case "priority":
      return statusValue(column, text);
    case "dropdown":
      return dropdownValue(column, text);
    case "person":
      return personValue(column, text, usersById);
    case "date":
    case "due_date":
      return dateValue(column, text);
    case "country":
    case "tags":
    case "rating":
    case "timeline":
      return checked(column, text);
    case "checkbox":
      return checkboxValue(column, text);
    case "number":
      return checked(column, text.trim().replace(/,/g, ""));
    case "link":
    case "text":
    case "long_text":
    case "email":
    case "phone":
      return checked(column, text);
    default:
      return { ok: false };
  }
}

function dropdownValue(column: ValueColumn, text: string): { ok: true; value: JsonValue | undefined } | { ok: false } {
  const ids: string[] = [];
  for (const token of text.split(/[,،]/).map((item) => item.trim()).filter(Boolean)) {
    const parsed = statusValue(column, token);
    if (!parsed.ok || typeof parsed.value !== "string") {
      return { ok: false };
    }
    if (!ids.includes(parsed.value)) {
      ids.push(parsed.value);
    }
  }
  return checked(column, ids);
}

function statusValue(column: ValueColumn, text: string): { ok: true; value: JsonValue | undefined } | { ok: false } {
  const options = readOptions(column.settings);
  const token = text.trim();
  const idMatch = options.find((option) => option.id === token || option.id.toLowerCase() === token.toLowerCase());
  const labelMatch = options.find((option) => normalizeName(option.label) === normalizeName(token));
  const match = idMatch ?? labelMatch;
  if (!match) {
    return { ok: false };
  }
  return checked(column, match.id);
}

function personValue(
  column: ValueColumn,
  text: string,
  usersById: ReadonlyMap<string, string>,
): { ok: true; value: JsonValue | undefined } | { ok: false } {
  const people: ImportPerson[] = [...usersById.entries()].map(([id, fullName]) => ({
    id,
    fullName,
    email: "",
  }));
  const planned: PlannedColumn = {
    columnId: "paste",
    name: "paste",
    type: "person",
    settings: plainSettings(column.settings),
    source: "existing",
  };
  const mapped = mapPerson(planned, text, indexPeople(people));
  if (mapped.value === undefined) {
    return { ok: false };
  }
  return checked(column, mapped.value);
}

function dateValue(column: ValueColumn, text: string): { ok: true; value: JsonValue | undefined } | { ok: false } {
  const normalized = text.trim().replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ");
  const iso = parseDate(normalized, "iso") ?? parseDate(expandMonth(normalized), "month") ?? parseDate(normalized, "dmy");
  if (!iso) {
    return { ok: false };
  }
  return checked(column, iso);
}

function checkboxValue(column: ValueColumn, text: string): { ok: true; value: JsonValue | undefined } | { ok: false } {
  const token = text.trim().toLowerCase();
  if (token === "true" || token === "yes" || token === "1" || text.trim() === "✓") {
    return checked(column, "true");
  }
  if (token === "false" || token === "no" || token === "0") {
    return checked(column, "false");
  }
  return { ok: false };
}

function checked(column: ValueColumn, raw: unknown): { ok: true; value: JsonValue | undefined } | { ok: false } {
  const normalized = normalizeValue(column, raw);
  if (!normalized.ok) {
    return { ok: false };
  }
  return { ok: true, value: normalized.value };
}

function expandMonth(value: string): string {
  return value.replace(/^[A-Za-z]+/, (token) => SHORT_MONTHS[token.toLowerCase()] ?? token);
}

function plainSettings(settings: unknown): Record<string, JsonValue> {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }
  return { ...(settings as Record<string, JsonValue>) };
}
