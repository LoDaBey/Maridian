import type { ColumnType } from "@/lib/db-types";

export const SHEET_TEMPLATES = ["blank"] as const;

export type SheetTemplateId = (typeof SHEET_TEMPLATES)[number];

export type SheetDirection = "rtl" | "ltr";

export interface ColumnDraft {
  id?: string;
  name: string;
  type: ColumnType;
  width: number;
  settings: Record<string, unknown>;
}

export function directionForTemplate(_template: SheetTemplateId): SheetDirection {
  return "rtl";
}

export function rowCountForTemplate(_template: SheetTemplateId): number {
  return 20;
}

export function columnsForTemplate(_template: SheetTemplateId): ColumnDraft[] {
  return [{ name: "الاسم", type: "text", width: 360, settings: {} }];
}
