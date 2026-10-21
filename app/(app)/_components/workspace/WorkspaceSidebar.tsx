"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Check,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  FileSpreadsheet,
  House,
  LayoutDashboard,
  Mail,
  Plus,
  Search,
  Users,
} from "lucide-react";
import type { WorkspaceBoard, WorkspaceSummary } from "@/lib/workspaces/repo";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { WorkspaceBadge } from "./WorkspaceBadge";

export const LAST_WORKSPACE_COOKIE = "monitor_ws";
const COLLAPSED_KEY = "monitor:sidebar-collapsed";

const ROLE_TEXT: Record<WorkspaceSummary["role"], string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function WorkspaceSidebar({
  workspaces,
  boards,
  sheets,
  invitationCount,
  canCreateWorkspace,
}: {
  workspaces: WorkspaceSummary[];
  boards: WorkspaceBoard[];
  sheets: Array<{ id: string; workbookId: string }>;
  invitationCount: number;
  canCreateWorkspace: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const [remembered, setRemembered] = useState<string | null>(null);
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Reading browser storage has to wait until after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync with localStorage/cookie
    setCollapsed(readCollapsed());
    const match = document.cookie.match(new RegExp(`(?:^|; )${LAST_WORKSPACE_COOKIE}=([^;]+)`));
    setRemembered(match?.[1] ?? null);
  }, []);

  const sheetWorkbook = useMemo(() => new Map(sheets.map((sheet) => [sheet.id, sheet.workbookId])), [sheets]);
  const boardById = useMemo(() => new Map(boards.map((board) => [board.id, board])), [boards]);

  const routeWorkspaceId = pathname.match(/^\/w\/([^/]+)/)?.[1] ?? null;
  const sheetId = pathname.match(/^\/s\/([^/]+)/)?.[1] ?? null;
  const sheetWorkspaceId = sheetId ? boardById.get(sheetWorkbook.get(sheetId) ?? "")?.workspaceId ?? null : null;
  const activeWorkbookId = sheetId ? sheetWorkbook.get(sheetId) ?? null : null;
  const currentId =
    [routeWorkspaceId, sheetWorkspaceId, remembered].find(
      (id) => id && workspaces.some((workspace) => workspace.id === id),
    ) ??
    workspaces[0]?.id ??
    null;
  const current = workspaces.find((workspace) => workspace.id === currentId) ?? null;

  useEffect(() => {
    if (current) {
      document.cookie = `${LAST_WORKSPACE_COOKIE}=${current.id}; path=/; max-age=31536000; samesite=lax`;
    }
  }, [current]);

  useEffect(() => {
    if (!switcherOpen) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (!switcherRef.current?.contains(event.target as Node)) {
        setSwitcherOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSwitcherOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [switcherOpen]);

  function toggleCollapsed() {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, value ? "0" : "1");
      } catch {
        // Storage can be blocked; the toggle still works for this page.
      }
      return !value;
    });
  }

  const workspaceBoards = boards.filter((board) => board.workspaceId === currentId);
  const needle = filter.trim().toLowerCase();
  const shownBoards = needle
    ? workspaceBoards.filter((board) => board.name.toLowerCase().includes(needle))
    : workspaceBoards;

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-2 border-e border-border bg-surface py-3">
        <button
          type="button"
          aria-label="Expand sidebar"
          className="cursor-pointer rounded-md p-1.5 text-muted hover:bg-bg hover:text-text"
          onClick={toggleCollapsed}
        >
          <ChevronsRight className="size-4" aria-hidden="true" />
        </button>
        {current ? (
          <Link href={`/w/${current.id}`} aria-label={`${current.name} home`} title={current.name}>
            <WorkspaceBadge name={current.name} color={current.color} size="sm" />
          </Link>
        ) : null}
      </aside>
    );
  }

  const navItem = (active: boolean) =>
    `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary ${
      active ? "bg-primary/10 font-medium text-primary" : "text-text hover:bg-bg"
    }`;

  return (
    <aside className="flex w-64 shrink-0 flex-col border-e border-border bg-surface">
      <div className="flex items-center justify-between px-3 pt-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Workspace</span>
        <button
          type="button"
          aria-label="Collapse sidebar"
          className="cursor-pointer rounded-md p-1 text-muted hover:bg-bg hover:text-text"
          onClick={toggleCollapsed}
        >
          <ChevronsLeft className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div ref={switcherRef} className="relative px-2 pt-2">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={switcherOpen}
          aria-label="Switch workspace"
          disabled={workspaces.length === 0 && !canCreateWorkspace}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5 text-start text-sm hover:bg-bg disabled:cursor-default"
          onClick={() => setSwitcherOpen((open) => !open)}
        >
          {current ? (
            <>
              <WorkspaceBadge name={current.name} color={current.color} size="sm" />
              <span className="min-w-0 flex-1 truncate font-medium">{current.name}</span>
            </>
          ) : (
            <span className="flex-1 text-muted">No workspace</span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden="true" />
        </button>
        {switcherOpen ? (
          <div className="absolute inset-x-2 top-full z-30 mt-1 rounded-lg border border-border bg-surface p-1 shadow-lg">
            <ul role="listbox" aria-label="Workspaces" className="max-h-72 overflow-auto">
              {workspaces.map((workspace) => (
                <li key={workspace.id} role="option" aria-selected={workspace.id === currentId}>
                  <Link
                    href={`/w/${workspace.id}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-bg"
                    onClick={() => setSwitcherOpen(false)}
                  >
                    <WorkspaceBadge name={workspace.name} color={workspace.color} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{workspace.name}</span>
                      <span className="block text-[11px] text-muted">
                        {workspace.isMember ? ROLE_TEXT[workspace.role] : "App admin"} ·{" "}
                        {workspace.memberCount} {workspace.memberCount === 1 ? "member" : "members"}
                      </span>
                    </span>
                    {workspace.id === currentId ? (
                      <Check className="size-4 text-primary" aria-hidden="true" />
                    ) : null}
                  </Link>
                </li>
              ))}
              {workspaces.length === 0 ? (
                <li className="px-2 py-1.5 text-sm text-muted">You aren&apos;t in any workspace yet.</li>
              ) : null}
            </ul>
            {canCreateWorkspace ? (
              <button
                type="button"
                className="mt-1 flex w-full cursor-pointer items-center gap-2 border-t border-border px-2 pb-1 pt-2 text-sm text-primary hover:underline"
                onClick={() => {
                  setSwitcherOpen(false);
                  setCreating(true);
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                Create workspace
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <nav aria-label="Workspace" className="mt-3 space-y-0.5 px-2">
        {current ? (
          <>
            <Link href={`/w/${current.id}`} className={navItem(pathname === `/w/${current.id}`)}>
              <House className="size-4" aria-hidden="true" />
              Home
            </Link>
            <Link href={`/w/${current.id}/dashboard`} className={navItem(pathname === `/w/${current.id}/dashboard`)}>
              <LayoutDashboard className="size-4" aria-hidden="true" />
              Dashboard
            </Link>
            <Link href={`/w/${current.id}/members`} className={navItem(pathname === `/w/${current.id}/members`)}>
              <Users className="size-4" aria-hidden="true" />
              <span className="flex-1">Members</span>
              <span className="text-xs text-muted">{current.memberCount}</span>
            </Link>
          </>
        ) : null}
        <Link href="/invitations" className={navItem(pathname === "/invitations")}>
          <Mail className="size-4" aria-hidden="true" />
          <span className="flex-1">Invitations</span>
          {invitationCount > 0 ? (
            <span className="rounded-full bg-primary px-1.5 text-[11px] font-medium text-white">
              {invitationCount}
            </span>
          ) : null}
        </Link>
      </nav>

      {current ? (
        <div className="mt-4 flex min-h-0 flex-1 flex-col px-2">
          <div className="flex items-center justify-between px-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Sheets</span>
            <Link
              href={`/w/${current.id}?new=1`}
              aria-label="New sheet"
              title="New sheet"
              className="rounded-md p-1 text-muted hover:bg-bg hover:text-text"
            >
              <Plus className="size-4" aria-hidden="true" />
            </Link>
          </div>
          {workspaceBoards.length > 8 ? (
            <label className="mx-1 mt-2 flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
              <Search className="size-3.5 text-muted" aria-hidden="true" />
              <input
                value={filter}
                placeholder="Filter sheets"
                aria-label="Filter sheets"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
          ) : null}
          <ul className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-auto pb-3">
            {shownBoards.map((board) => (
              <li key={board.id}>
                {board.firstTabId ? (
                  <Link
                    href={`/s/${board.firstTabId}`}
                    className={navItem(board.id === activeWorkbookId)}
                    title={board.name}
                  >
                    <FileSpreadsheet className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{board.name}</span>
                  </Link>
                ) : (
                  <span className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted">
                    <FileSpreadsheet className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{board.name}</span>
                  </span>
                )}
              </li>
            ))}
            {workspaceBoards.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-muted">No sheets you can open yet.</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </aside>
  );
}
