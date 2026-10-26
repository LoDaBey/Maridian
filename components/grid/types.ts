import type { DirectoryUser, TimelineRange } from "@/lib/db-types";
import type { Role } from "@/lib/rbac";
import type { SheetOp } from "@/lib/sheets/ops";

export type { DirectoryUser };

export interface ColumnFilterOption {
  key: string;
  label: string;
}

export interface DirectoryResponse {
  users: DirectoryUser[];
}

export interface SheetViewer {
  id: string;
  role: Role;
  /** Shared with this person as a viewer: the grid is read-only for them. */
  viewOnly?: boolean;
  /** Shared as "assigned only": edits items assigned to them, never the sheet structure. */
  assignedOnly?: boolean;
}

export interface CellAddress {
  rowId: string;
  columnId: string;
}

export type SelectionKind = "cell" | "row" | "column";

export interface GridSelection {
  anchor: CellAddress;
  focus: CellAddress;
  kind: SelectionKind;
}

export interface EditSession {
  rowId: string;
  columnId: string;
  seed: string | null;
}

export interface HistoryEntry {
  forward: { type: SheetOp["type"]; payload: SheetOp["payload"] };
  inverse: { type: SheetOp["type"]; payload: SheetOp["payload"] };
}

export type BoardLayout = "table" | "kanban" | "timeline" | "chart";

export interface KanbanLane {
  id: string;
  label: string;
  color: string;
  rowIds: string[];
}

export interface CardDetail {
  id: string;
  label: string;
  text: string;
}

export interface ItemSchedule {
  columnId: string;
  kind: "timeline" | "date";
  range: TimelineRange;
}

export type BoardItem =
  | { kind: "header"; groupId: string; key: string }
  | { kind: "columns"; groupId: string; key: string }
  | { kind: "row"; groupId: string; rowId: string; key: string }
  | { kind: "group-summary"; groupId: string; key: string }
  | { kind: "add-item"; groupId: string; key: string }
  | { kind: "sheet-summary"; key: string };

export interface SelectionBounds {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
}
