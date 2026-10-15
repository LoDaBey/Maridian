import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "./env";

const globalForDb = globalThis as typeof globalThis & {
  __pool?: Pool;
};

function createPool(): Pool {
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  });
}

export const pool = globalForDb.__pool ?? createPool();

if (!globalForDb.__pool) {
  globalForDb.__pool = pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Keep the original error if the connection is already dead.
    }
    throw error;
  } finally {
    client.release();
  }
}
