import { z } from "zod";
import type { ColumnType } from "@/lib/db-types";

export const COLUMN_TYPES = [
  "text",
  "long_text",
  "link",
  "date",
  "person",
  "status",
  "number",
  "checkbox",
  "timeline",
  "tags",
  "dropdown",
  "country",
  "priority",
  "rating",
  "files",
  "due_date",
  "created_by",
  "created_at",
  "updated_at",
  "item_id",
] as const satisfies readonly ColumnType[];

const positionSchema = z.string().trim().min(1, "Enter a position.").max(200);
const nameSchema = z.string().trim().min(1, "Enter a column name.").max(100);
const groupNameSchema = z.string().trim().min(1, "Enter a group name.").max(100);
const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Choose a color.");
const widthSchema = z.number().int().min(60).max(800);
const idList = (max: number) => z.array(z.uuid()).min(1).max(max);

const cellValueSchema = z.object({
  rowId: z.uuid(),
  columnId: z.uuid(),
  value: z.unknown().nullable(),
});

const rowInsertSchema = z.object({
  rowId: z.uuid(),
  position: positionSchema,
  groupId: z.uuid().optional(),
  itemNumber: z.number().int().positive().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const duplicatedRowSchema = z.object({
  rowId: z.uuid(),
  position: positionSchema,
  data: z.record(z.string(), z.unknown()).optional(),
});

export const sheetOpSchema = z.discriminatedUnion("type", [
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("cell.set"),
    payload: z.object({
      rowId: z.uuid(),
      columnId: z.uuid(),
      value: z.unknown().nullable(),
    }),
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("cells.setMany"),
    payload: z.object({
      cells: z.array(cellValueSchema).min(1).max(5000),
    }),
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("row.insert"),
    payload: rowInsertSchema,
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("rows.insertMany"),
    payload: z.object({
      rows: z.array(rowInsertSchema).min(1).max(1000),
    }),
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("row.delete"),
    payload: z.object({ rowIds: idList(1000) }),
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("row.restore"),
    payload: z.object({ rowIds: idList(1000) }),
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("row.move"),
    payload: z.object({
      rowId: z.uuid(),
      position: positionSchema,
      groupId: z.uuid().optional(),
    }),
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("group.insert"),
    payload: z.object({
      groupId: z.uuid(),
      name: groupNameSchema,
      color: colorSchema.optional(),
      position: positionSchema,
    }),
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("group.update"),
    payload: z.object({
      groupId: z.uuid(),
      patch: z
        .object({
          name: groupNameSchema.optional(),
          color: colorSchema.optional(),
        })
        .refine((patch) => patch.name !== undefined || patch.color !== undefined, {
          message: "Nothing to update.",
        }),
    }),
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("group.move"),
    payload: z.object({
      groupId: z.uuid(),
      position: positionSchema,
    }),
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("group.delete"),
    payload: z.object({ groupId: z.uuid() }),
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("group.restore"),
    payload: z.object({ groupId: z.uuid() }),
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("group.duplicate"),
    payload: z.object({
      sourceGroupId: z.uuid(),
      groupId: z.uuid(),
      name: groupNameSchema,
      color: colorSchema.optional(),
      position: positionSchema,
      rows: z.array(duplicatedRowSchema).max(1000),
    }),
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("column.insert"),
    payload: z.object({
      columnId: z.uuid(),
      name: nameSchema,
      type: z.enum(COLUMN_TYPES),
      position: positionSchema,
      width: widthSchema.optional(),
      settings: z.unknown().optional(),
    }),
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("column.update"),
    payload: z.object({
      columnId: z.uuid(),
      patch: z
        .object({
          name: nameSchema.optional(),
          type: z.enum(COLUMN_TYPES).optional(),
          settings: z.unknown().optional(),
        })
        .refine((patch) => patch.name !== undefined || patch.type !== undefined || patch.settings !== undefined, {
          message: "Nothing to update.",
        }),
    }),
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("column.resize"),
    payload: z.object({
      columnId: z.uuid(),
      width: widthSchema,
    }),
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("column.delete"),
    payload: z.object({ columnId: z.uuid() }),
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("column.restore"),
    payload: z.object({ columnId: z.uuid() }),
  }),
  z.object({
    clientOpId: z.uuid(),
    sheetId: z.uuid(),
    type: z.literal("column.move"),
    payload: z.object({
      columnId: z.uuid(),
      position: positionSchema,
    }),
  }),
]);

export type SheetOp = z.infer<typeof sheetOpSchema>;
export type OpType = SheetOp["type"];

export interface NormalizedCell {
  rowId: string;
  columnId: string;
  value: JsonValue | null;
}

export type JsonValue =
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export type NormalizedOp = SheetOp;
