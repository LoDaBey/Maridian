import { isAutomaticColumnType, type ColumnType, type StatusOption } from "@/lib/db-types";
import type { JsonValue } from "@/lib/sheets/ops";
import {
  FILE_MAX_COUNT,
  PRIORITY_OPTIONS,
  TAG_MAX_COUNT,
  TAG_MAX_LENGTH,
  asFileList,
  asStringList,
  asTimeline,
  defaultColumnSettings,
} from "@/lib/sheets/column-meta";
import { countryByCode, countryLabel, findCountry } from "@/lib/sheets/countries";
import { canonicalizeUrl } from "@/lib/urls";

const TEXT_MAX = 10_000;
const LABEL_MAX = 500;
const PERSON_MAX = 100;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ValueColumn {
  type: ColumnType;
  settings?: unknown;
}

export type { StatusOption };

export type NormalizeResult =
  | { ok: true; value: JsonValue | undefined }
  | { ok: false; error: string };

export type SettingsResult =
  | { ok: true; settings: Record<string, JsonValue> }
  | { ok: false; error: string };

export const APPEARANCE_KEYS = ["headerColor", "fillColor", "frozen", "rules"] as const;

export function normalizeSettings(type: ColumnType, settings: unknown): SettingsResult {
  if (type === "status" || type === "dropdown") {
    return normalizeStatusSettings(settings ?? defaultColumnSettings(type));
  }
  if (type === "priority") {
    return normalizePrioritySettings(settings);
  }
  if (type === "person") {
    return normalizePersonSettings(settings ?? { multiple: false });
  }
  if (type === "due_date") {
    return normalizeDueSettings(settings ?? { remind: false });
  }
  if (type === "timeline") {
    return normalizeTimelineSettings(settings ?? { color: "#579bfc" });
  }
  if (settings === undefined || settings === null) {
    return { ok: true, settings: {} };
  }
  if (!isPlainObject(settings)) {
    return { ok: false, error: "This column does not take settings." };
  }
  if (Object.keys(settings).some((key) => !isAppearanceKey(key))) {
    return { ok: false, error: "This column does not take settings." };
  }
  const appearance = readAppearance(settings);
  if (!appearance.ok) {
    return appearance;
  }
  return { ok: true, settings: appearance.settings };
}

export function mergeColumnSettings(type: ColumnType, current: unknown, patch: unknown): SettingsResult {
  const base = isPlainObject(current) ? current : {};
  const extra = isPlainObject(patch) ? patch : {};
  return normalizeSettings(type, { ...base, ...extra });
}

export function appearanceFromSettings(settings: unknown): Record<string, JsonValue> {
  const parsed = isPlainObject(settings) ? readAppearance(settings) : { ok: true as const, settings: {} };
  return parsed.ok ? parsed.settings : {};
}

export function isAppearanceOnlySettingsChange(previous: unknown, next: unknown): boolean {
  return jsonLooseEqual(stripAppearance(previous), stripAppearance(next));
}

export function isAppearanceOnlyColumnUpdate(patch: {
  name?: string;
  type?: string;
  settings?: unknown;
}): boolean {
  if (patch.name !== undefined || patch.type !== undefined || patch.settings === undefined) {
    return false;
  }
  if (!isPlainObject(patch.settings)) {
    return false;
  }
  const keys = Object.keys(patch.settings);
  return keys.length > 0 && keys.every((key) => isAppearanceKey(key));
}

export function readFillColor(settings: unknown, key: "headerColor" | "fillColor"): string | undefined {
  if (!isPlainObject(settings)) {
    return undefined;
  }
  const parsed = parseFill(settings[key]);
  return parsed.ok ? parsed.color : undefined;
}

export function normalizeValue(column: ValueColumn, raw: unknown): NormalizeResult {
  if (raw === null || raw === undefined) {
    return { ok: true, value: undefined };
  }

  switch (column.type) {
    case "text":
    case "long_text":
      return normalizeText(raw);
    case "link":
      return normalizeLink(raw);
    case "email":
      return normalizeEmail(raw);
    case "phone":
      return normalizePhone(raw);
    case "date":
    case "due_date":
      return normalizeDate(raw);
    case "person":
      return normalizePerson(raw, personMultiple(column.settings));
    case "status":
    case "priority":
      return normalizeStatus(raw, statusOptions(column.settings));
    case "dropdown":
      return normalizeMultiStatus(raw, statusOptions(column.settings));
    case "tags":
      return normalizeTags(raw);
    case "country":
      return normalizeCountry(raw);
    case "rating":
      return normalizeRating(raw);
    case "timeline":
      return normalizeTimeline(raw);
    case "files":
      return normalizeFiles(raw);
    case "number":
      return normalizeNumber(raw);
    case "checkbox":
      return normalizeCheckbox(raw);
    case "created_by":
    case "created_at":
    case "updated_at":
    case "item_id":
    case "progress":
      return { ok: false, error: "This column is automatic." };
    default:
      return { ok: false, error: "Unknown column type." };
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(raw: unknown): NormalizeResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Enter an email address." };
  }
  const value = raw.trim().replace(/^mailto:/i, "");
  if (!value) {
    return { ok: true, value: undefined };
  }
  if (value.length > 254 || !EMAIL_PATTERN.test(value)) {
    return { ok: false, error: "Enter a valid email address, like name@company.com." };
  }
  return { ok: true, value: value.toLowerCase() };
}

/** Keeps the number as typed (spaces, dashes, +), but it must hold 6-20 digits. */
function normalizePhone(raw: unknown): NormalizeResult {
  if (typeof raw !== "string" && typeof raw !== "number") {
    return { ok: false, error: "Enter a phone number." };
  }
  const value = String(raw).trim().replace(/^tel:/i, "");
  if (!value) {
    return { ok: true, value: undefined };
  }
  const digits = value.replace(/\D/g, "");
  if (!/^\+?[\d\s().-]+$/.test(value) || digits.length < 6 || digits.length > 20) {
    return { ok: false, error: "Enter a valid phone number, like +971 50 123 4567." };
  }
  return { ok: true, value: value.replace(/\s+/g, " ") };
}

function acceptConverted(
  toType: ColumnType,
  toSettings: unknown,
  value: JsonValue,
  cleared: boolean,
): { value: JsonValue | undefined; cleared: boolean } {
  const normalized = normalizeValue({ type: toType, settings: toSettings }, value);
  if (!normalized.ok || normalized.value === undefined) {
    return { value: undefined, cleared: true };
  }
  return { value: normalized.value, cleared };
}

export function convertValue(
  value: JsonValue | undefined,
  fromType: ColumnType,
  toType: ColumnType,
  toSettings: unknown,
): { value: JsonValue | undefined; cleared: boolean } {
  if (value === undefined) {
    return { value: undefined, cleared: false };
  }

  if (isAutomaticColumnType(toType) || isAutomaticColumnType(fromType)) {
    return { value: undefined, cleared: value !== undefined };
  }

  const column: ValueColumn = { type: toType, settings: toSettings };
  if (fromType === toType) {
    const normalized = normalizeValue(column, value);
    if (!normalized.ok) {
      return { value: undefined, cleared: true };
    }
    return { value: normalized.value, cleared: normalized.value === undefined };
  }

  if (fromType === "date" && toType === "due_date") {
    return acceptConverted(toType, toSettings, value as JsonValue, false);
  }
  if (fromType === "due_date" && toType === "date") {
    return acceptConverted(toType, toSettings, value as JsonValue, false);
  }
  if (fromType === "status" && toType === "dropdown" && typeof value === "string") {
    return acceptConverted(toType, toSettings, [value], false);
  }
  if (fromType === "dropdown" && toType === "status" && Array.isArray(value)) {
    const first = value.find((item): item is string => typeof item === "string");
    return first ? acceptConverted(toType, toSettings, first, value.length > 1) : { value: undefined, cleared: true };
  }
  if (fromType === "date" && toType === "timeline" && typeof value === "string") {
    return acceptConverted(toType, toSettings, { start: value, end: value }, false);
  }

  if (toType === "text" || toType === "long_text") {
    const text = displayValue({ type: fromType, settings: toSettings }, value, new Map());
    if (!text) {
      return { value: undefined, cleared: true };
    }
    return acceptConverted(toType, toSettings, text, false);
  }

  if (toType === "rating") {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? parseNumberText(value.trim()) : undefined;
    if (parsed !== undefined && Number.isInteger(parsed) && parsed >= 1 && parsed <= 5) {
      return acceptConverted(toType, toSettings, parsed, false);
    }
    return { value: undefined, cleared: true };
  }

  if (fromType !== "text" && fromType !== "long_text") {
    return { value: undefined, cleared: true };
  }

  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return { value: undefined, cleared: true };
  }

  if (toType === "number") {
    const parsed = parseNumberText(text);
    return parsed === undefined ? { value: undefined, cleared: true } : acceptConverted(toType, toSettings, parsed, false);
  }

  if (toType === "date" || toType === "due_date") {
    const parsed = parseDateText(text);
    return parsed === undefined ? { value: undefined, cleared: true } : acceptConverted(toType, toSettings, parsed, false);
  }

  if (toType === "status" || toType === "priority" || toType === "dropdown") {
    const match = statusOptions(toSettings).find(
      (option) => option.label.toLowerCase() === text.toLowerCase(),
    );
    if (!match) {
      return { value: undefined, cleared: true };
    }
    return acceptConverted(toType, toSettings, toType === "dropdown" ? [match.id] : match.id, false);
  }

  if (toType === "country") {
    const match = findCountry(text);
    return match ? acceptConverted(toType, toSettings, match.code, false) : { value: undefined, cleared: true };
  }

  if (toType === "tags") {
    const tags = text
      .split(/[,،]/)
      .map((item) => item.trim())
      .filter(Boolean);
    return tags.length ? acceptConverted(toType, toSettings, tags, false) : { value: undefined, cleared: true };
  }

  if (toType === "timeline") {
    const parts = text.split(/\s*(?:–|-|to|إلى)\s*/);
    if (parts.length === 2) {
      const start = parseDateText(parts[0] ?? "");
      const end = parseDateText(parts[1] ?? "");
      if (start && end) {
        return acceptConverted(toType, toSettings, start <= end ? { start, end } : { start: end, end: start }, false);
      }
    }
    return { value: undefined, cleared: true };
  }

  if (toType === "email" || toType === "phone") {
    const normalized = toType === "email" ? normalizeEmail(text) : normalizePhone(text);
    if (!normalized.ok || normalized.value === undefined) {
      return { value: undefined, cleared: true };
    }
    return acceptConverted(toType, toSettings, normalized.value, false);
  }

  if (toType === "link") {
    const normalized = normalizeLink(text);
    if (!normalized.ok || normalized.value === undefined) {
      return { value: undefined, cleared: true };
    }
    return acceptConverted(toType, toSettings, normalized.value, false);
  }

  return { value: undefined, cleared: true };
}

export function displayValue(
  column: ValueColumn,
  value: JsonValue | undefined,
  usersById: ReadonlyMap<string, string>,
): string {
  if (value === undefined) {
    return "";
  }

  switch (column.type) {
    case "text":
    case "long_text":
    case "email":
    case "phone":
      return typeof value === "string" ? value : "";
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
    case "checkbox":
      return value === true ? "true" : value === false ? "false" : "";
    case "date":
    case "due_date":
      return typeof value === "string" && isCalendarDate(value) ? value : "";
    case "country": {
      if (typeof value !== "string") {
        return "";
      }
      const country = countryByCode(value);
      return country ? countryLabel(country, true) : value;
    }
    case "priority":
    case "dropdown":
    case "status": {
      if (column.type === "dropdown") {
        return asStringList(value)
          .map((id) => statusOptions(column.settings).find((option) => option.id === id)?.label ?? id)
          .join(", ");
      }
      if (typeof value !== "string") {
        return "";
      }
      return statusOptions(column.settings).find((option) => option.id === value)?.label ?? value;
    }
    case "tags":
      return asStringList(value).join(", ");
    case "rating":
      return typeof value === "number" && value >= 1 && value <= 5 ? `${value}` : "";
    case "timeline": {
      const range = asTimeline(value);
      return range ? `${range.start} – ${range.end}` : "";
    }
    case "files":
      return asFileList(value)
        .map((file) => file.name)
        .join(", ");
    case "link":
      if (!isPlainObject(value) || typeof value.url !== "string") {
        return "";
      }
      return typeof value.label === "string" && value.label ? value.label : value.url;
    case "person": {
      if (!Array.isArray(value)) {
        return "";
      }
      return value
        .filter((item): item is string => typeof item === "string")
        .map((id) => usersById.get(id) ?? id)
        .join(", ");
    }
    default:
      return "";
  }
}

function normalizeText(raw: unknown): NormalizeResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Enter text." };
  }
  const value = raw.trim();
  if (!value) {
    return { ok: true, value: undefined };
  }
  if (value.length > TEXT_MAX) {
    return { ok: false, error: "Text is too long." };
  }
  return { ok: true, value };
}

function normalizeNumber(raw: unknown): NormalizeResult {
  if (typeof raw === "number") {
    return Number.isFinite(raw)
      ? { ok: true, value: raw }
      : { ok: false, error: "Enter a number." };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: "Enter a number." };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }
  const parsed = parseNumberText(trimmed);
  return parsed === undefined
    ? { ok: false, error: "Enter a number." }
    : { ok: true, value: parsed };
}

function normalizeCheckbox(raw: unknown): NormalizeResult {
  if (typeof raw === "boolean") {
    return { ok: true, value: raw };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: "Choose true or false." };
  }
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }
  if (trimmed === "true") {
    return { ok: true, value: true };
  }
  if (trimmed === "false") {
    return { ok: true, value: false };
  }
  return { ok: false, error: "Choose true or false." };
}

function normalizeDate(raw: unknown): NormalizeResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Enter a date as YYYY-MM-DD." };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }
  if (!isCalendarDate(trimmed)) {
    return { ok: false, error: "Enter a date as YYYY-MM-DD." };
  }
  return { ok: true, value: trimmed };
}

function normalizeLink(raw: unknown): NormalizeResult {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { ok: true, value: undefined };
    }
    const url = canonicalizeUrl(trimmed);
    return url ? { ok: true, value: { url } } : { ok: false, error: "Enter an http or https link." };
  }
  if (!isPlainObject(raw)) {
    return { ok: false, error: "Enter an http or https link." };
  }
  if (typeof raw.url !== "string") {
    return { ok: false, error: "Enter an http or https link." };
  }
  const urlText = raw.url.trim();
  if (!urlText) {
    return { ok: true, value: undefined };
  }
  const url = canonicalizeUrl(urlText);
  if (!url) {
    return { ok: false, error: "Enter an http or https link." };
  }
  const link: { url: string; label?: string } = { url };
  if (raw.label !== undefined && raw.label !== null) {
    if (typeof raw.label !== "string") {
      return { ok: false, error: "Link label must be text." };
    }
    const label = raw.label.trim();
    if (label.length > LABEL_MAX) {
      return { ok: false, error: "Link label is too long." };
    }
    if (label) {
      link.label = label;
    }
  }
  return { ok: true, value: link };
}

function normalizePerson(raw: unknown, multiple: boolean): NormalizeResult {
  const source = Array.isArray(raw) ? raw : [raw];
  if (source.length === 1 && typeof source[0] === "string" && !source[0].trim()) {
    return { ok: true, value: undefined };
  }
  if (source.length === 0) {
    return { ok: true, value: undefined };
  }
  const ids: string[] = [];
  for (const item of source) {
    if (typeof item !== "string" || !UUID_PATTERN.test(item.trim())) {
      return { ok: false, error: "Enter a person id." };
    }
    ids.push(item.trim().toLowerCase());
  }
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: "Person ids must be unique." };
  }
  if (!multiple && ids.length > 1) {
    return { ok: false, error: "This column accepts one person." };
  }
  if (ids.length > PERSON_MAX) {
    return { ok: false, error: "Too many people." };
  }
  return { ok: true, value: ids };
}

function normalizeStatus(raw: unknown, options: StatusOption[]): NormalizeResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Choose a status." };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }
  if (!options.some((option) => option.id === trimmed)) {
    return { ok: false, error: "Choose a status." };
  }
  return { ok: true, value: trimmed };
}

function normalizeMultiStatus(raw: unknown, options: StatusOption[]): NormalizeResult {
  const source = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,،]/) : null;
  if (!source) {
    return { ok: false, error: "Choose one or more values." };
  }
  const ids: string[] = [];
  for (const item of source) {
    if (typeof item !== "string") {
      return { ok: false, error: "Choose one or more values." };
    }
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    const match = options.find((option) => option.id === trimmed || option.label.toLowerCase() === trimmed.toLowerCase());
    if (!match) {
      return { ok: false, error: "Choose a listed value." };
    }
    if (!ids.includes(match.id)) {
      ids.push(match.id);
    }
  }
  return { ok: true, value: ids.length ? ids : undefined };
}

function normalizeTags(raw: unknown): NormalizeResult {
  const source = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,،]/) : null;
  if (!source) {
    return { ok: false, error: "Enter tags." };
  }
  const tags: string[] = [];
  for (const item of source) {
    if (typeof item !== "string") {
      return { ok: false, error: "Enter tags." };
    }
    const label = item.trim();
    if (!label) {
      continue;
    }
    if (label.length > TAG_MAX_LENGTH) {
      return { ok: false, error: `Tags must be ${TAG_MAX_LENGTH} characters or fewer.` };
    }
    const exists = tags.some((tag) => tag.toLowerCase() === label.toLowerCase());
    if (!exists) {
      tags.push(label);
    }
  }
  if (tags.length > TAG_MAX_COUNT) {
    return { ok: false, error: `A cell can have ${TAG_MAX_COUNT} tags.` };
  }
  return { ok: true, value: tags.length ? tags : undefined };
}

function normalizeCountry(raw: unknown): NormalizeResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Choose a country." };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }
  const match = countryByCode(trimmed) ?? findCountry(trimmed);
  if (!match) {
    return { ok: false, error: "Choose a country from the list." };
  }
  return { ok: true, value: match.code };
}

function normalizeRating(raw: unknown): NormalizeResult {
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? parseNumberText(raw.trim()) : undefined;
  if (raw === "" || raw === null) {
    return { ok: true, value: undefined };
  }
  if (typeof raw === "string" && !raw.trim()) {
    return { ok: true, value: undefined };
  }
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
    return { ok: false, error: "Choose a rating from 1 to 5." };
  }
  return { ok: true, value: parsed };
}

function normalizeTimeline(raw: unknown): NormalizeResult {
  if (typeof raw === "string") {
    const parts = raw.split(/\s*(?:–|-|to|إلى)\s*/);
    if (parts.length === 2) {
      return normalizeTimeline({ start: parts[0], end: parts[1] });
    }
    return { ok: false, error: "Enter a start and end date." };
  }
  const range = asTimeline(raw);
  if (!range) {
    if (isPlainObject(raw) && !raw.start && !raw.end) {
      return { ok: true, value: undefined };
    }
    return { ok: false, error: "Enter a start and end date." };
  }
  if (!isCalendarDate(range.start) || !isCalendarDate(range.end)) {
    return { ok: false, error: "Enter dates as YYYY-MM-DD." };
  }
  if (range.start > range.end) {
    return { ok: true, value: { start: range.end, end: range.start } };
  }
  return { ok: true, value: { start: range.start, end: range.end } };
}

function normalizeFiles(raw: unknown): NormalizeResult {
  const files = asFileList(raw);
  if (!Array.isArray(raw)) {
    return { ok: false, error: "Add a file link." };
  }
  if (files.length === 0) {
    return { ok: true, value: undefined };
  }
  if (files.length > FILE_MAX_COUNT) {
    return { ok: false, error: `A cell can have ${FILE_MAX_COUNT} files.` };
  }
  const next: JsonValue[] = [];
  for (const file of files) {
    if (!file.name.trim() || file.name.length > 200) {
      return { ok: false, error: "File name is invalid." };
    }
    const url = canonicalizeUrl(file.url);
    if (!url) {
      return { ok: false, error: "Enter an http or https file link." };
    }
    next.push({
      id: file.id,
      name: file.name.trim(),
      url,
    });
  }
  return { ok: true, value: next };
}

function normalizeStatusSettings(settings: unknown): SettingsResult {
  if (!isPlainObject(settings) || !Array.isArray(settings.options)) {
    return { ok: false, error: "Status settings need options." };
  }
  if (Object.keys(settings).some((key) => key !== "options" && !isAppearanceKey(key))) {
    return { ok: false, error: "Status settings need options." };
  }
  if (settings.options.length > 50) {
    return { ok: false, error: "Status columns can have 50 options." };
  }
  const options: JsonValue[] = [];
  const ids: string[] = [];
  for (const option of settings.options) {
    if (!isPlainObject(option)) {
      return { ok: false, error: "Status option is invalid." };
    }
    const id = typeof option.id === "string" ? option.id.trim() : "";
    const label = typeof option.label === "string" ? option.label.trim() : "";
    const color = typeof option.color === "string" ? option.color.trim() : "";
    if (!id || id.length > 64) {
      return { ok: false, error: "Status option is invalid." };
    }
    if (!label || label.length > 50) {
      return { ok: false, error: "Status label must be 1 to 50 characters." };
    }
    if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) {
      return { ok: false, error: "Status color must be a hex color." };
    }
    options.push({ id, label, color });
    ids.push(id);
  }
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: "Status option ids must be unique." };
  }
  const appearance = readAppearance(settings);
  if (!appearance.ok) {
    return appearance;
  }
  return { ok: true, settings: { options, ...appearance.settings } };
}

function normalizePrioritySettings(settings: unknown): SettingsResult {
  const appearance = isPlainObject(settings) ? readAppearance(settings) : { ok: true as const, settings: {} };
  if (!appearance.ok) {
    return appearance;
  }
  return {
    ok: true,
    settings: { options: PRIORITY_OPTIONS.map((option) => ({ ...option })), ...appearance.settings },
  };
}

function normalizeDueSettings(settings: unknown): SettingsResult {
  if (!isPlainObject(settings)) {
    return { ok: false, error: "Due date settings need remind." };
  }
  if (Object.keys(settings).some((key) => key !== "remind" && !isAppearanceKey(key))) {
    return { ok: false, error: "Due date settings need remind." };
  }
  if (settings.remind !== undefined && typeof settings.remind !== "boolean") {
    return { ok: false, error: "Remind must be true or false." };
  }
  const appearance = readAppearance(settings);
  if (!appearance.ok) {
    return appearance;
  }
  return { ok: true, settings: { remind: settings.remind === true, ...appearance.settings } };
}

function normalizeTimelineSettings(settings: unknown): SettingsResult {
  if (!isPlainObject(settings)) {
    return { ok: false, error: "Timeline settings need a color." };
  }
  if (Object.keys(settings).some((key) => key !== "color" && !isAppearanceKey(key))) {
    return { ok: false, error: "Timeline settings need a color." };
  }
  const color = typeof settings.color === "string" ? settings.color.trim() : "";
  if (color && !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
    return { ok: false, error: "Timeline color must be a hex color." };
  }
  const appearance = readAppearance(settings);
  if (!appearance.ok) {
    return appearance;
  }
  return { ok: true, settings: { color: color ? color.toLowerCase() : "#579bfc", ...appearance.settings } };
}

function normalizePersonSettings(settings: unknown): SettingsResult {
  if (!isPlainObject(settings) || typeof settings.multiple !== "boolean") {
    return { ok: false, error: "Person settings need multiple." };
  }
  if (Object.keys(settings).some((key) => key !== "multiple" && !isAppearanceKey(key))) {
    return { ok: false, error: "Person settings need multiple." };
  }
  const appearance = readAppearance(settings);
  if (!appearance.ok) {
    return appearance;
  }
  return { ok: true, settings: { multiple: settings.multiple, ...appearance.settings } };
}

function personMultiple(settings: unknown): boolean {
  const parsed = normalizePersonSettings(settings ?? { multiple: false });
  return parsed.ok ? parsed.settings.multiple === true : false;
}

export function labeledOptions(settings: unknown): StatusOption[] {
  return statusOptions(settings);
}

function statusOptions(settings: unknown): StatusOption[] {
  if (isPlainObject(settings) && Array.isArray(settings.options) && settings.options.length === 4) {
    const ids = settings.options.map((option) => (isPlainObject(option) ? option.id : null));
    if (PRIORITY_OPTIONS.every((option, index) => ids[index] === option.id)) {
      return PRIORITY_OPTIONS.map((option) => ({ ...option }));
    }
  }
  const parsed = normalizeStatusSettings(settings ?? { options: [] });
  if (!parsed.ok || !Array.isArray(parsed.settings.options)) {
    return [];
  }
  const options: StatusOption[] = [];
  for (const option of parsed.settings.options) {
    if (
      isPlainObject(option) &&
      typeof option.id === "string" &&
      typeof option.label === "string" &&
      typeof option.color === "string"
    ) {
      options.push({ id: option.id, label: option.label, color: option.color });
    }
  }
  return options;
}

function parseNumberText(value: string): number | undefined {
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDateText(value: string): string | undefined {
  if (isCalendarDate(value)) {
    return value;
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const year = Number(slash[3]);
    const iso = isoDate(year, month, day);
    return iso && isCalendarDate(iso) ? iso : undefined;
  }
  const monthName = new RegExp(`^(${MONTHS.join("|")})\\s+(\\d{1,2}),\\s+(\\d{4})$`, "i").exec(value);
  if (!monthName) {
    return undefined;
  }
  const month = MONTHS.indexOf(monthName[1]?.toLowerCase() ?? "") + 1;
  const iso = isoDate(Number(monthName[3]), month, Number(monthName[2]));
  return iso && isCalendarDate(iso) ? iso : undefined;
}

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAppearanceKey(key: string): boolean {
  return (APPEARANCE_KEYS as readonly string[]).includes(key);
}

function readAppearance(settings: Record<string, unknown>): SettingsResult {
  const next: Record<string, JsonValue> = {};
  // Columns up to the one marked "frozen" stay in view while scrolling sideways.
  if (settings.frozen === true) {
    next.frozen = true;
  }
  if (settings.rules !== undefined && settings.rules !== null) {
    const rules = parseRules(settings.rules);
    if (!rules) {
      return { ok: false, error: "Check the conditional formatting rules." };
    }
    if (rules.length > 0) {
      next.rules = rules;
    }
  }
  for (const key of ["headerColor", "fillColor"] as const) {
    if (!(key in settings)) {
      continue;
    }
    const parsed = parseFill(settings[key]);
    if (!parsed.ok) {
      return { ok: false, error: "Fill color must be a hex color." };
    }
    if (parsed.color) {
      next[key] = parsed.color;
    }
  }
  return { ok: true, settings: next };
}

export const RULE_OPS = ["eq", "neq", "contains", "not_contains", "gt", "lt", "between", "empty", "not_empty"] as const;
export type RuleOp = (typeof RULE_OPS)[number];

/** Conditional formatting: the first matching rule paints the cell. */
export interface FormatRule {
  op: RuleOp;
  value?: string;
  value2?: string;
  color: string;
}

function parseRules(value: unknown): JsonValue[] | null {
  if (!Array.isArray(value) || value.length > 10) {
    return null;
  }
  const rules: JsonValue[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw) || !(RULE_OPS as readonly string[]).includes(String(raw.op))) {
      return null;
    }
    const fill = parseFill(raw.color);
    if (!fill.ok || !fill.color) {
      return null;
    }
    const text = (input: unknown) => (typeof input === "string" || typeof input === "number" ? String(input).slice(0, 200) : undefined);
    const rule: Record<string, JsonValue> = { op: String(raw.op), color: fill.color };
    const first = text(raw.value);
    const second = text(raw.value2);
    if (first !== undefined) {
      rule.value = first;
    }
    if (second !== undefined) {
      rule.value2 = second;
    }
    rules.push(rule);
  }
  return rules;
}

function parseFill(value: unknown): { ok: true; color?: string } | { ok: false } {
  if (value === undefined || value === null || value === "") {
    return { ok: true };
  }
  if (typeof value !== "string" || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
    return { ok: false };
  }
  return { ok: true, color: value.toLowerCase() };
}

function stripAppearance(settings: unknown): Record<string, unknown> {
  if (!isPlainObject(settings)) {
    return {};
  }
  const rest = { ...settings };
  for (const key of APPEARANCE_KEYS) {
    delete rest[key];
  }
  return rest;
}

function jsonLooseEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
