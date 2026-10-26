export type Role =
  | "employee"
  | "team_leader"
  | "project_manager"
  | "operations_manager"
  | "admin";

export type ColumnType =
  | "text"
  | "long_text"
  | "link"
  | "date"
  | "person"
  | "status"
  | "number"
  | "checkbox"
  | "timeline"
  | "tags"
  | "dropdown"
  | "country"
  | "priority"
  | "rating"
  | "files"
  | "due_date"
  | "created_by"
  | "created_at"
  | "updated_at"
  | "item_id"
  | "email"
  | "phone"
  | "progress";

export type PriorityLevel = "critical" | "high" | "medium" | "low";

export type DueTone = "overdue" | "today" | null;

export interface TimelineRange {
  start: string;
  end: string;
}

export interface TimelineScale {
  startMs: number;
  endMs: number;
}

export interface TimelineBarRect {
  startPct: number;
  widthPct: number;
}

export interface FileAttachment {
  id: string;
  name: string;
  url: string;
}

export interface CountryRecord {
  code: string;
  name: string;
  nameAr?: string;
}

export interface StatusOption {
  id: string;
  label: string;
  color: string;
}

export const AUTOMATIC_COLUMN_TYPES = [
  "created_by",
  "created_at",
  "updated_at",
  "item_id",
  "progress",
] as const satisfies readonly ColumnType[];

export function isAutomaticColumnType(type: ColumnType): boolean {
  return (AUTOMATIC_COLUMN_TYPES as readonly ColumnType[]).includes(type);
}

export const GROUP_COLORS = [
  "#579bfc",
  "#00c875",
  "#fdab3d",
  "#e2445c",
  "#a25ddc",
  "#037f4c",
  "#ff642e",
  "#66ccff",
  "#9cd326",
  "#c4c4c4",
  "#784bd1",
  "#333333",
] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];

export const FILL_COLORS = [
  "#fff3bf",
  "#d3f9d8",
  "#d0ebff",
  "#ffe3e3",
  "#f3d9fa",
  "#ffe8cc",
  "#e9ecef",
  "#c5f6fa",
  "#ffd8a8",
  "#d0bfff",
  "#b2f2bb",
  "#a5d8ff",
] as const;

export type FillColor = (typeof FILL_COLORS)[number];

export type NotificationType = "mention" | "assign" | "reply" | "status" | "due" | "share" | "invitation" | "access_request";

export interface NotificationItem {
  id: string;
  userId: string;
  type: NotificationType;
  /** Null for notifications that aren't about one sheet (invitations). */
  sheetId: string | null;
  rowId: string | null;
  actorId: string | null;
  actorName: string;
  actorColor: string;
  sheetName: string;
  excerpt: string;
  /** Where clicking the notification goes. */
  href: string;
  createdAt: string;
  readAt: string | null;
}

export type SheetDirection = "rtl" | "ltr";

export interface SheetPreviewCell {
  text: string;
  color: string | null;
  pill: boolean;
}

export interface SheetPreviewRow {
  color: string;
  cells: SheetPreviewCell[];
}

export interface SheetPreview {
  direction: SheetDirection;
  columns: string[];
  rows: SheetPreviewRow[];
}

export type NewSheetChoice = "import" | "blank" | `saved:${string}`;

export type NewSheetStep = "name" | "start" | "review" | "file" | "map" | "preview";

export interface SpreadsheetTable {
  headers: string[];
  rows: string[][];
}

export interface ImportSheetSummary {
  name: string;
  rowCount: number;
  columnCount: number;
}

export interface ImportColumnDraft {
  id: string;
  name: string;
  type: ColumnType;
  settings: Record<string, unknown>;
}

export interface ImportRowDraft {
  id: string;
  data: Record<string, unknown>;
}

export interface ImportWorkbookTabDraft {
  name: string;
  columns: ImportColumnDraft[];
  rows: ImportRowDraft[];
}

export interface MonitorUser {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  avatar_color: string;
  last_login_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MonitorUserWithHash extends MonitorUser {
  password_hash: string;
}

export interface MonitorUserSession {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  ip: string | null;
  user_agent: string | null;
}

export interface MonitorWorkbook {
  id: string;
  name: string;
  position: string;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  archived_by: string | null;
  deleted_at: Date | null;
  deleted_by: string | null;
}

export const WORKBOOK_PURGE_DAYS = 30;

export interface DeletedWorkbookSummary {
  id: string;
  name: string;
  createdBy: string | null;
  createdByName: string;
  deletedAt: string;
  deletedBy: string | null;
  deletedByName: string;
  purgeAt: string;
  canPurge: boolean;
}

export interface Sheet {
  id: string;
  workbook_id: string;
  name: string;
  position: string;
  direction: SheetDirection;
  version: string;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  archived_by: string | null;
}

export interface Column {
  id: string;
  sheet_id: string;
  name: string;
  type: ColumnType;
  position: string;
  width: number;
  settings: Record<string, unknown>;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface Row {
  id: string;
  sheet_id: string;
  group_id: string | null;
  item_number: number;
  position: string;
  data: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface MonitorGroup {
  id: string;
  sheet_id: string;
  name: string;
  color: string;
  position: string;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface MonitorUpdate {
  id: string;
  sheet_id: string;
  row_id: string;
  body: string;
  author_id: string;
  mentions: string[];
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface MonitorUpdateReply {
  id: string;
  update_id: string;
  sheet_id: string;
  row_id: string;
  body: string;
  author_id: string;
  mentions: string[];
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface MonitorNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  sheet_id: string;
  row_id: string | null;
  actor_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
  read_at: Date | null;
}

export interface SavedTemplateColumn {
  name: string;
  type: ColumnType;
  width: number;
  settings: Record<string, unknown>;
}

export interface SavedTemplateGroup {
  name: string;
  color: string;
}

export interface SavedTemplateTab {
  name: string;
  direction: SheetDirection;
  columns: SavedTemplateColumn[];
  rowCount: number;
  groups?: SavedTemplateGroup[];
}

export interface SavedTemplatePayload {
  tabs: SavedTemplateTab[];
}

export interface MonitorSheetTemplate {
  id: string;
  name: string;
  payload: SavedTemplatePayload;
  created_by: string | null;
  created_at: Date;
}

export type MentionToken =
  | { kind: "text"; value: string }
  | { kind: "mention"; value: string; userId?: string };

export interface DirectoryUser {
  id: string;
  fullName: string;
  email: string;
  avatarColor: string;
  isActive: boolean;
}

export interface WorkbookMember {
  userId: string;
  fullName: string;
  email: string;
  role: Role;
  avatarColor: string;
  boardRole: "owner" | "editor" | "assigned" | "viewer";
  isOwner: boolean;
  addedAt: string;
}

export interface UpdateAuthorDto {
  id: string;
  fullName: string;
  avatarColor: string;
}

export interface UpdateReplyDto {
  id: string;
  body: string;
  author: UpdateAuthorDto;
  mentions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpdateReactionDto {
  emoji: string;
  userIds: string[];
}

export interface RowUpdateDto {
  id: string;
  body: string;
  author: UpdateAuthorDto;
  mentions: string[];
  attachments: FileAttachment[];
  replies: UpdateReplyDto[];
  reactions: UpdateReactionDto[];
  seenBy: UpdateAuthorDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEntry {
  id: string;
  sheet_id: string | null;
  user_id: string | null;
  action: string;
  row_id: string | null;
  column_id: string | null;
  old_value: unknown;
  new_value: unknown;
  sheet_version: string | null;
  created_at: Date;
}
