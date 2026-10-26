import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { getSheet } from "@/lib/sheets/sheets-repo";
import { getSheetAccess } from "@/lib/sheets/workbook-access";
import { SheetClient } from "./_components/SheetClient";

export const instant = false;

export default async function SheetPage({
  params,
}: {
  params: Promise<{ sheetId: string }>;
}) {
  const { sheetId } = await params;
  const user = await requireUser();
  const sheet = await getSheet(sheetId);

  const access = sheet && !sheet.archivedAt ? await getSheetAccess(user, sheet.id) : null;
  if (!sheet || !access) {
    notFound();
  }

  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted">Loading sheet…</p>}>
      <SheetClient
        sheetId={sheet.id}
        workbookId={sheet.workbookId}
        workbookName={sheet.workbookName}
        me={{ id: user.id, role: user.role, viewOnly: access.role === "viewer", assignedOnly: access.role === "assigned" }}
      />
    </Suspense>
  );
}
