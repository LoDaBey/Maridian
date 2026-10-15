import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

if (!process.env.NODE_ENV) {
  Object.assign(process.env, { NODE_ENV: "development" });
}

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

async function main(): Promise<void> {
  const { pool, tx } = await import("../lib/db");
  const schemaPath = path.join(process.cwd(), "db", "schema.sql");
  const sql = await readFile(schemaPath, "utf8");

  try {
    await tx(async (client) => {
      await client.query(sql);
    });
    console.log("Schema applied");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Migration failed";
  console.error(message);
  process.exit(1);
});
