import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { generateNKeysBetween } from "fractional-indexing";
import type { ColumnType } from "@/lib/db-types";
import type { SessionUser } from "@/lib/auth/session";

loadEnv();

const TYPES: ColumnType[] = [
  "text",
  "long_text",
  "link",
  "date",
  "person",
  "status",
  "number",
  "checkbox",
  "text",
  "text",
  "text",
  "text",
];

async function main(): Promise<void> {
  const { query, pool } = await import("@/lib/db");
  const { applyOp } = await import("@/lib/sheets/apply-op");
  const admin = await query<{
    id: string;
    email: string;
    full_name: string;
    role: SessionUser["role"];
    avatar_color: string;
    must_change_password: boolean;
  }>(
    `SELECT id, email, full_name, role, avatar_color, must_change_password
     FROM monitor_users
     WHERE email = 'admin@company.com' AND is_active = true`,
  );
  const row = admin[0];
  if (!row) {
    throw new Error("admin@company.com is missing");
  }
  const user: SessionUser = {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    avatarColor: row.avatar_color,
    mustChangePassword: row.must_change_password,
  };
  const sheetId = randomUUID();
  await query(
    `INSERT INTO monitor_sheets (id, name, position, direction, created_by)
     VALUES ($1, 'T09 5000', 'a0', 'rtl', $2)`,
    [sheetId, user.id],
  );

  const columnIds = Array.from({ length: TYPES.length }, () => randomUUID());
  const columnPositions = generateNKeysBetween(null, null, columnIds.length);
  for (let index = 0; index < columnIds.length; index += 1) {
    const columnId = columnIds[index];
    const position = columnPositions[index];
    const type = TYPES[index];
    if (!columnId || !position || !type) {
      continue;
    }
    const settings = type === "person" ? { multiple: false } : type === "status" ? { options: [{ id: "done", label: "Done", color: "#00c875" }] } : {};
    const result = await applyOp(user, {
      clientOpId: randomUUID(),
      sheetId,
      type: "column.insert",
      payload: { columnId, name: `Column ${index + 1}`, type, position, settings },
    });
    if (!result.ok) {
      throw new Error(result.message);
    }
  }

  const rowIds = Array.from({ length: 5000 }, () => randomUUID());
  const rowPositions = generateNKeysBetween(null, null, rowIds.length);
  const firstColumn = columnIds[0];
  for (let offset = 0; offset < rowIds.length; offset += 1000) {
    const slice = rowIds.slice(offset, offset + 1000);
    const result = await applyOp(user, {
      clientOpId: randomUUID(),
      sheetId,
      type: "rows.insertMany",
      payload: {
        rows: slice.map((rowId, index) => ({
          rowId,
          position: rowPositions[offset + index] ?? `z${offset + index}`,
          data: firstColumn ? { [firstColumn]: `Row ${offset + index + 1}` } : {},
        })),
      },
    });
    if (!result.ok) {
      throw new Error(result.message);
    }
  }

  console.log(`seeded ${sheetId} with 5000 rows`);
  await pool.end();
}

function loadEnv(): void {
  const text = readFileSync(".env.local", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index);
    if (!process.env[key]) {
      process.env[key] = trimmed.slice(index + 1);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "seed failed");
  process.exit(1);
});
