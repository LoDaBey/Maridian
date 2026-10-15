import { connection } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  await connection();

  try {
    await query("select 1");
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }

  return Response.json({
    ok: true,
    db: true,
    time: new Date().toISOString(),
  });
}
