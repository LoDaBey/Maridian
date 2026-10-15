import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import { listArchivedWorkbooks, listSheetTemplates, listWorkbooks } from "@/lib/sheets/sheets-repo";
import { SheetHome } from "./_components/SheetHome";

export const instant = false;

export default async function HomePage() {
  const user = await requireUser();
  const canRestore = can(user.role, "sheet.restore");
  const [workbooks, archived, savedTemplates] = await Promise.all([
    listWorkbooks(user),
    canRestore ? listArchivedWorkbooks(user) : Promise.resolve([]),
    listSheetTemplates(),
  ]);

  return (
    <SheetHome
      workbooks={workbooks}
      archived={archived}
      savedTemplates={savedTemplates}
      canCreate={can(user.role, "sheet.create")}
      canRestore={canRestore}
      currentUserId={user.id}
      role={user.role}
    />
  );
}
