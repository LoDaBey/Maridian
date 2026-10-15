import { connection } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { listDirectoryUsers } from "@/lib/users";

export async function GET() {
  await connection();
  await requireUser();
  const users = await listDirectoryUsers();

  return Response.json(
    { users },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
