import { requirePermission } from "@/lib/auth/current-user";
import { listDeletedWorkbooks } from "@/lib/sheets/sheets-repo";
import { DeletedSheetsAdmin } from "./_components/DeletedSheetsAdmin";

export const instant = false;

export default async function AdminSheetsPage() {
  await requirePermission("sheet.purge");
  const workbooks = await listDeletedWorkbooks();

  return <DeletedSheetsAdmin workbooks={workbooks} />;
}
