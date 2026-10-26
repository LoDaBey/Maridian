"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Clock, FileSpreadsheet, Folder, LayoutDashboard, Mail, Plus, Search, Star, Table2, Users } from "lucide-react";
import { listPaletteDashboards } from "@/app/(app)/favorites-actions";
import { can, type Role } from "@/lib/rbac";
import type { WorkspaceBoard } from "@/lib/workspaces/repo";

export const OPEN_PALETTE_EVENT = "meridian:palette";
const RECENT_KEY = "meridian:recent-sheets";

interface Item {
  id: string;
  label: string;
  hint?: string;
  section: string;
  href: string;
  icon: typeof Search;
  /** Lower-case text searched by the filter. */
  text: string;
}

function readRecent(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function rememberRecent(workbookId: string) {
  try {
    const next = [workbookId, ...readRecent().filter((id) => id !== workbookId)].slice(0, 8);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private mode: recents just aren't kept.
  }
}

/** Ctrl/⌘ K: jump to any sheet, tab, dashboard or workspace, or start something new. */
export function CommandPalette({
  role,
  workspaces,
  boards,
  sheets,
  favoriteIds,
}: {
  role: Role;
  workspaces: Array<{ id: string; name: string; color: string }>;
  boards: WorkspaceBoard[];
  sheets: Array<{ id: string; workbookId: string; name: string }>;
  favoriteIds: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [dashboards, setDashboards] = useState<Array<{ id: string; name: string; workspaceId: string; workspaceName: string }> | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Remember sheets as they're opened.
  useEffect(() => {
    const sheetId = pathname.match(/^\/s\/([^/]+)/)?.[1];
    const workbookId = sheets.find((sheet) => sheet.id === sheetId)?.workbookId;
    if (workbookId) {
      rememberRecent(workbookId);
    }
  }, [pathname, sheets]);

  useEffect(() => {
    const toggle = () => {
      setOpen((value) => !value);
      setQuery("");
      setActive(0);
      setRecent(readRecent());
    };
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, toggle);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, toggle);
    };
  }, []);

  useEffect(() => {
    if (open && dashboards === null) {
      void listPaletteDashboards().then(setDashboards);
    }
  }, [open, dashboards]);

  const workspaceName = useMemo(() => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])), [workspaces]);
  const currentWorkspace = pathname.match(/^\/w\/([^/]+)/)?.[1] ?? workspaces[0]?.id;

  const items = useMemo<Item[]>(() => {
    const boardItem = (board: WorkspaceBoard, section: string, icon: typeof Search): Item => ({
      id: `${section}:${board.id}`,
      label: board.name,
      hint: workspaceName.get(board.workspaceId),
      section,
      href: `/s/${board.firstTabId}`,
      icon,
      text: board.name.toLowerCase(),
    });
    const openable = boards.filter((board) => board.firstTabId);
    const byId = new Map(openable.map((board) => [board.id, board]));
    const needle = query.trim().toLowerCase();
    const list: Item[] = [];
    if (!needle) {
      for (const id of recent) {
        const board = byId.get(id);
        if (board) {
          list.push(boardItem(board, "Recent", Clock));
        }
      }
      for (const id of favoriteIds) {
        const board = byId.get(id);
        if (board) {
          list.push(boardItem(board, "Favourites", Star));
        }
      }
    } else {
      list.push(...openable.map((board) => boardItem(board, "Sheets", FileSpreadsheet)));
      const boardName = new Map(boards.map((board) => [board.id, board.name]));
      list.push(
        ...sheets.map((sheet) => ({
          id: `tab:${sheet.id}`,
          label: sheet.name,
          hint: boardName.get(sheet.workbookId),
          section: "Tabs",
          href: `/s/${sheet.id}`,
          icon: Table2,
          text: `${sheet.name} ${boardName.get(sheet.workbookId) ?? ""}`.toLowerCase(),
        })),
      );
      list.push(
        ...(dashboards ?? []).map((dashboard) => ({
          id: `dash:${dashboard.id}`,
          label: dashboard.name,
          hint: dashboard.workspaceName,
          section: "Dashboards",
          href: `/w/${dashboard.workspaceId}/dashboards/${dashboard.id}`,
          icon: LayoutDashboard,
          text: dashboard.name.toLowerCase(),
        })),
      );
      list.push(
        ...workspaces.map((workspace) => ({
          id: `ws:${workspace.id}`,
          label: workspace.name,
          section: "Workspaces",
          href: `/w/${workspace.id}`,
          icon: Folder,
          text: workspace.name.toLowerCase(),
        })),
      );
    }
    const actions: Item[] = [
      ...(currentWorkspace && can(role, "sheet.create")
        ? [{ id: "new-sheet", label: "New sheet", section: "Actions", href: `/w/${currentWorkspace}?new=1`, icon: Plus, text: "new sheet create board" }]
        : []),
      ...(currentWorkspace
        ? [
            { id: "dashboards", label: "Dashboards", section: "Go to", href: `/w/${currentWorkspace}/dashboards`, icon: LayoutDashboard, text: "dashboards charts reports" },
            { id: "members", label: "Members", section: "Go to", href: `/w/${currentWorkspace}/members`, icon: Users, text: "members people invite" },
          ]
        : []),
      { id: "invitations", label: "Invitations", section: "Go to", href: "/invitations", icon: Mail, text: "invitations invites" },
      ...(can(role, "team.manage") ? [{ id: "teams", label: "Teams", section: "Go to", href: "/admin/teams", icon: Users, text: "teams leaders" }] : []),
      ...(can(role, "user.manage") ? [{ id: "users", label: "Users", section: "Go to", href: "/admin/users", icon: Users, text: "users accounts admin" }] : []),
    ];
    list.push(...actions);
    if (!needle) {
      return list;
    }
    const scored = list
      .map((item) => {
        const at = item.text.indexOf(needle);
        const label = item.label.toLowerCase();
        return { item, score: label.startsWith(needle) ? 0 : at === 0 ? 1 : at > 0 ? 2 : -1 };
      })
      .filter((entry) => entry.score >= 0);
    // Keep sections together, best matches first inside each.
    const order = ["Sheets", "Tabs", "Dashboards", "Workspaces", "Actions", "Go to"];
    return scored
      .sort((a, b) => order.indexOf(a.item.section) - order.indexOf(b.item.section) || a.score - b.score)
      .slice(0, 40)
      .map((entry) => entry.item);
  }, [boards, sheets, dashboards, workspaces, recent, favoriteIds, query, role, currentWorkspace, workspaceName]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) {
    return null;
  }

  function go(item: Item | undefined) {
    if (!item) {
      return;
    }
    setOpen(false);
    router.push(item.href);
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search Meridian"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="size-4 text-muted" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            dir="auto"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={items[active] ? `palette-${active}` : undefined}
            placeholder="Search sheets, tabs, dashboards…"
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(items.length - 1, index + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                go(items[active]);
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">Esc</kbd>
        </div>
        <ul id="palette-results" ref={listRef} role="listbox" className="max-h-[50vh] overflow-auto p-2">
          {items.length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted">Nothing matches “{query}”.</li> : null}
          {items.map((item, index) => {
            const header = index === 0 || items[index - 1]!.section !== item.section ? item.section : null;
            const Icon = item.icon;
            return (
              <li key={item.id} role="presentation">
                {header ? <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted">{header}</p> : null}
                <button
                  id={`palette-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-start text-sm ${index === active ? "bg-primary/10 text-primary" : "hover:bg-row"}`}
                  onMouseMove={() => setActive(index)}
                  onClick={() => go(item)}
                >
                  <Icon className={`size-4 shrink-0 ${item.section === "Favourites" ? "fill-[#fdab3d] text-[#fdab3d]" : ""}`} aria-hidden="true" />
                  <span dir="auto" className="min-w-0 flex-1 truncate">
                    {item.label}
                  </span>
                  {item.hint ? (
                    <span dir="auto" className="max-w-[40%] truncate text-xs text-muted">
                      {item.hint}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted">↑ ↓ to move · Enter to open · Ctrl K to toggle</p>
      </div>
    </div>,
    document.body,
  );
}
