import { connection } from "next/server";
import { sendDueReminders } from "@/lib/sheets/due-reminders";

export async function POST(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const created = await sendDueReminders();
  return Response.json({ created });
}

export async function GET(request: Request) {
  return POST(request);
}
