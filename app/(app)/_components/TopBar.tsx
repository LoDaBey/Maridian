"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppLogo } from "@/components/brand/AppLogo";
import { APP_NAME } from "@/lib/brand";
import type { Role } from "@/lib/rbac";
import type { SheetSummary } from "@/lib/sheets/sheets-repo";
import { Search } from "lucide-react";
import { AdminNav } from "./AdminNav";
import { OPEN_PALETTE_EVENT } from "./CommandPalette";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";

export function TopBar({
  fullName,
  role,
  avatarColor,
  sheets,
}: {
  fullName: string;
  role: Role;
  avatarColor: string;
  sheets: SheetSummary[];
}) {
  const pathname = usePathname();
  const sheetId = pathname.match(/^\/s\/([^/]+)$/)?.[1];
  const current = sheets.find((sheet) => sheet.id === sheetId);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 text-sm">
      <Link href="/" className="shrink-0 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`${APP_NAME} home`}>
        <AppLogo />
      </Link>
      <p className="min-w-0 truncate font-medium">{current?.workbookName ?? ""}</p>
      <div className="flex-1" />
      <button
        type="button"
        aria-label="Search (Ctrl K)"
        className="hidden h-8 cursor-pointer items-center gap-2 rounded-lg border border-border px-2.5 text-muted hover:bg-row hover:text-text md:inline-flex"
        onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}
      >
        <Search className="size-4" aria-hidden="true" />
        <span>Search</span>
        <kbd className="rounded border border-border px-1 text-[10px]">Ctrl K</kbd>
      </button>
      <AdminNav role={role} />
      <div id="presence-slot" />
      <div id="save-status-slot" />
      <ThemeToggle />
      <NotificationBell />
      <UserMenu fullName={fullName} role={role} avatarColor={avatarColor} />
    </header>
  );
}
