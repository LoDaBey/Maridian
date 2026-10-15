import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import { listActiveSheets, listArchivedSheets } from "@/lib/sheets/sheets-repo";
import { ConnectionBanner } from "./_components/ConnectionBanner";
import { RealtimeProvider } from "./_components/RealtimeProvider";
import { SheetTabs } from "./_components/SheetTabs";
import { TopBar } from "./_components/TopBar";

export const instant = false;

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  const sheets = await listActiveSheets();
  const archived = can(user.role, "sheet.restore") ? await listArchivedSheets() : [];

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <ConnectionBanner />
      <RealtimeProvider />
      <TopBar
        fullName={user.fullName}
        role={user.role}
        avatarColor={user.avatarColor}
        sheets={sheets}
      />
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      <SheetTabs role={user.role} sheets={sheets} archived={archived} />
    </div>
  );
}
