"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, EyeOff, Lock } from "lucide-react";
import { ProtectDialog, TabVisibilityDialog } from "@/components/grid/ProtectDialog";
import { AddTabButton } from "./AddTabButton";
import {
  archiveSheet,
  createTab,
  moveSheet,
  renameSheet,
  setSheetDirection,
} from "@/app/(app)/sheets/actions";
import { can, type Role } from "@/lib/rbac";
import type { SheetSummary } from "@/lib/sheets/sheets-repo";
import { useWorkspaceUsers } from "@/stores/presence-store";
import { ArchivedSheetsDialog } from "./ArchivedSheetsDialog";
import { DuplicateSheetDialog } from "./DuplicateSheetDialog";
import { TabMenu, type TabMenuItem } from "./TabMenu";

function nextTabName(sheets: SheetSummary[]): string {
  const taken = new Set(sheets.map((sheet) => sheet.name));
  let number = sheets.length + 1;
  while (taken.has(`Tab ${number}`)) {
    number += 1;
  }
  return `Tab ${number}`;
}

export function SheetTabs({
  role,
  sheets,
  archived,
  managedWorkbookIds = [],
}: {
  role: Role;
  sheets: SheetSummary[];
  archived: SheetSummary[];
  /** Sheets this person can protect and hide tabs on. */
  managedWorkbookIds?: string[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const allMenuId = useId();
  const allRootRef = useRef<HTMLDivElement>(null);
  const allItemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const renameLock = useRef(false);
  const skipBlur = useRef(false);
  const [creating, setCreating] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [duplicating, setDuplicating] = useState<SheetSummary | null>(null);
  const [protecting, setProtecting] = useState<SheetSummary | null>(null);
  const [hiding, setHiding] = useState<SheetSummary | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<{
    sheetId: string;
    left: number;
    bottom: number;
  } | null>(null);

  const activeId = pathname.match(/^\/s\/([^/]+)$/)?.[1] ?? null;
  const active = sheets.find((sheet) => sheet.id === activeId) ?? null;
  const workbookId = active?.workbookId ?? null;
  const tabs = useMemo(
    () => (workbookId ? sheets.filter((sheet) => sheet.workbookId === workbookId) : []),
    [workbookId, sheets],
  );
  const archivedTabs = workbookId
    ? archived.filter((sheet) => sheet.workbookId === workbookId)
    : [];
  const onSheet = Boolean(activeId && workbookId);
  const canCreate = can(role, "sheet.create");
  const canRename = can(role, "sheet.rename");
  const canDuplicate = can(role, "sheet.duplicate");
  const canDirection = can(role, "sheet.direction");
  const canReorder = can(role, "sheet.reorder");
  const canArchive = can(role, "sheet.archive");
  const canRestore = can(role, "sheet.restore");

  useEffect(() => {
    if (!activeId) {
      return;
    }
    document.getElementById(`sheet-tab-${activeId}`)?.scrollIntoView({
      inline: "nearest",
      block: "nearest",
    });
  }, [activeId, tabs]);

  useEffect(() => {
    if (!allOpen) {
      return;
    }
    allItemRefs.current[0]?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!allRootRef.current?.contains(event.target as Node)) {
        setAllOpen(false);
      }
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setAllOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [allOpen]);

  function addBlankTab() {
    if (!workbookId || creating) {
      return;
    }
    setCreating(true);
    setError("");
    void createTab({
      workbookId,
      name: nextTabName(tabs),
      template: "blank",
    }).then((result) => {
      setCreating(false);
      if (result.error || !result.id) {
        setError(result.error || "Could not create the tab.");
        return;
      }
      router.push(`/s/${result.id}`);
    });
  }

  function deleteTab(sheet: SheetSummary) {
    void archiveSheet({ id: sheet.id }).then((result) => {
      if (result.error) {
        setError(result.error);
        return;
      }
      if (pathname === `/s/${sheet.id}`) {
        router.push(result.workbookArchived || !result.nextTabId ? "/" : `/s/${result.nextTabId}`);
      }
    });
  }

  async function commitRename(sheet: SheetSummary) {
    if (skipBlur.current) {
      skipBlur.current = false;
      return;
    }
    if (renameLock.current) {
      return;
    }
    renameLock.current = true;
    const name = draft.trim();
    setRenamingId(null);
    try {
      if (!name || name === sheet.name) {
        return;
      }
      const result = await renameSheet({ id: sheet.id, name });
      if (result.error) {
        setError(result.error);
      }
    } finally {
      renameLock.current = false;
    }
  }

  function menuItems(sheet: SheetSummary, index: number): TabMenuItem[] {
    const items: TabMenuItem[] = [];
    if (canRename) {
      items.push({
        id: "rename",
        label: "Rename",
        onSelect: () => {
          setDraft(sheet.name);
          setRenamingId(sheet.id);
        },
      });
    }
    if (canDuplicate) {
      items.push({
        id: "duplicate",
        label: "Duplicate…",
        onSelect: () => setDuplicating(sheet),
      });
    }
    if (canDirection) {
      items.push(
        {
          id: "rtl",
          label: "Direction: RTL",
          onSelect: () => {
            void setSheetDirection({ id: sheet.id, direction: "rtl" }).then((result) => {
              if (result.error) {
                setError(result.error);
              }
            });
          },
        },
        {
          id: "ltr",
          label: "Direction: LTR",
          onSelect: () => {
            void setSheetDirection({ id: sheet.id, direction: "ltr" }).then((result) => {
              if (result.error) {
                setError(result.error);
              }
            });
          },
        },
      );
    }
    if (canReorder && index > 0) {
      const before = tabs[index - 1];
      if (before) {
        items.push({
          id: "left",
          label: "Move left",
          onSelect: () => {
            void moveSheet({ id: sheet.id, beforeId: before.id }).then((result) => {
              if (result.error) {
                setError(result.error);
              }
            });
          },
        });
      }
    }
    if (canReorder && index < tabs.length - 1) {
      const after = tabs[index + 1];
      if (after) {
        items.push({
          id: "right",
          label: "Move right",
          onSelect: () => {
            void moveSheet({ id: sheet.id, afterId: after.id }).then((result) => {
              if (result.error) {
                setError(result.error);
              }
            });
          },
        });
      }
    }
    if (managedWorkbookIds.includes(sheet.workbookId)) {
      items.push(
        {
          id: "protect",
          label: sheet.locked ? "Tab protection…" : "Protect tab…",
          onSelect: () => setProtecting(sheet),
        },
        {
          id: "visibility",
          label: sheet.hidden ? "Who can see this tab… (hidden)" : "Who can see this tab…",
          onSelect: () => setHiding(sheet),
        },
      );
    }
    if (canArchive) {
      items.push({
        id: "delete",
        label: "Delete",
        danger: true,
        onSelect: () => deleteTab(sheet),
      });
    }
    return items;
  }

  function onAllKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = allItemRefs.current.filter((item) => item !== null);
    const index = items.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    }
  }

  const openSheet = menu ? tabs.find((sheet) => sheet.id === menu.sheetId) : null;
  const openIndex = openSheet ? tabs.findIndex((sheet) => sheet.id === openSheet.id) : -1;
  const openItems = openSheet ? menuItems(openSheet, openIndex) : [];

  if (!onSheet) {
    return null;
  }

  return (
    <div className="relative flex h-10 shrink-0 items-stretch border-t border-border bg-surface text-sm">
      {error ? (
        <p role="alert" className="absolute bottom-full left-3 z-20 mb-1 rounded-md bg-surface px-2 py-1 text-danger shadow-sm">
          {error}
        </p>
      ) : null}
      {canCreate ? (
        <AddTabButton pending={creating} onAdd={addBlankTab} />
      ) : null}
      <div ref={allRootRef} className="relative flex items-stretch">
        <button
          type="button"
          aria-label="All tabs"
          aria-haspopup="menu"
          aria-expanded={allOpen}
          aria-controls={allMenuId}
          className="cursor-pointer rounded-md px-3 hover:bg-bg"
          onClick={() => setAllOpen((current) => !current)}
        >
          All tabs
        </button>
        {allOpen ? (
          <div
            id={allMenuId}
            role="menu"
            aria-label="All tabs"
            className="absolute bottom-full left-0 z-30 mb-1 max-h-80 w-64 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-sm"
            onKeyDown={onAllKeyDown}
          >
            {tabs.length === 0 ? (
              <p className="px-3 py-2 text-muted">No tabs yet</p>
            ) : (
              tabs.map((sheet, index) => (
                <Link
                  key={sheet.id}
                  ref={(node) => {
                    allItemRefs.current[index] = node;
                  }}
                  role="menuitem"
                  href={`/s/${sheet.id}`}
                  className="block cursor-pointer truncate rounded-md px-3 py-1.5 hover:bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  aria-current={sheet.id === activeId ? "page" : undefined}
                  onClick={() => setAllOpen(false)}
                >
                  {sheet.name}
                </Link>
              ))
            )}
          </div>
        ) : null}
      </div>
      <div data-sheet-tabs className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((sheet, index) => {
          const active = sheet.id === activeId;
          const actions = menuItems(sheet, index);
          return (
            <div
              key={sheet.id}
              id={`sheet-tab-${sheet.id}`}
              className={`flex shrink-0 items-stretch border-b-2 ${active ? "border-primary" : "border-transparent"}`}
              onContextMenu={(event) => {
                if (actions.length === 0) {
                  return;
                }
                event.preventDefault();
                setMenu({
                  sheetId: sheet.id,
                  left: event.clientX,
                  bottom: window.innerHeight - event.clientY,
                });
              }}
            >
              {renamingId === sheet.id ? (
                <input
                  aria-label={`Rename ${sheet.name}`}
                  value={draft}
                  autoFocus
                  maxLength={100}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void commitRename(sheet);
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      skipBlur.current = true;
                      setRenamingId(null);
                    }
                  }}
                  onBlur={() => {
                    void commitRename(sheet);
                  }}
                  className="my-1 w-36 rounded-md border border-border px-2 outline-none"
                />
              ) : (
                <Link
                  href={`/s/${sheet.id}`}
                  aria-current={active ? "page" : undefined}
                  className={`flex max-w-48 items-center gap-1 truncate px-3 ${active ? "font-medium" : "text-muted hover:text-text"}`}
                >
                  <span className="truncate">{sheet.name}</span>
                  {sheet.locked ? <Lock className="size-3 shrink-0 text-muted" aria-label="Protected tab" /> : null}
                  {sheet.hidden ? <EyeOff className="size-3 shrink-0 text-muted" aria-label="Hidden from some people" /> : null}
                  <TabPresence sheetId={sheet.id} />
                </Link>
              )}
              {actions.length > 0 ? (
                <button
                  type="button"
                  data-tab-menu-trigger=""
                  aria-label={`Tab actions for ${sheet.name}`}
                  aria-haspopup="menu"
                  aria-expanded={menu?.sheetId === sheet.id}
                  className="cursor-pointer rounded-md px-1 text-muted hover:bg-bg hover:text-text"
                  onClick={(event) => {
                    if (menu?.sheetId === sheet.id) {
                      setMenu(null);
                      return;
                    }
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMenu({
                      sheetId: sheet.id,
                      left: rect.left,
                      bottom: window.innerHeight - rect.top + 4,
                    });
                  }}
                >
                  <ChevronDown aria-hidden="true" className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {canRestore ? (
        <button
          type="button"
          aria-label="Archived tabs"
          className="cursor-pointer rounded-md px-3 text-muted hover:bg-bg hover:text-text"
          onClick={() => setArchivedOpen(true)}
        >
          Archived tabs
        </button>
      ) : null}
      {menu && openItems.length > 0 ? (
        <TabMenu
          label={openSheet ? `Tab actions for ${openSheet.name}` : "Tab actions"}
          items={openItems}
          position={{ left: menu.left, bottom: menu.bottom }}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {protecting ? (
        <ProtectDialog
          sheetId={protecting.id}
          scope="tab"
          targetId={null}
          targetName={protecting.name}
          onClose={() => {
            setProtecting(null);
            router.refresh();
          }}
        />
      ) : null}
      {hiding ? (
        <TabVisibilityDialog
          sheetId={hiding.id}
          tabName={hiding.name}
          onClose={() => {
            setHiding(null);
            router.refresh();
          }}
        />
      ) : null}
      {duplicating ? (
        <DuplicateSheetDialog
          sourceId={duplicating.id}
          sourceName={duplicating.name}
          onClose={() => setDuplicating(null)}
        />
      ) : null}
      {archivedOpen ? (
        <ArchivedSheetsDialog sheets={archivedTabs} onClose={() => setArchivedOpen(false)} />
      ) : null}
    </div>
  );
}

function TabPresence({ sheetId }: { sheetId: string }) {
  const users = useWorkspaceUsers(sheetId);
  if (users.length === 0) {
    return null;
  }
  const shown = users.slice(0, 3);
  return (
    <span className="inline-flex shrink-0 items-center">
      {shown.map((user) => (
        <span
          key={user.userId}
          title={user.fullName}
          className="inline-flex size-4 items-center justify-center rounded-full text-[8px] font-medium text-white"
          style={{ backgroundColor: user.avatarColor }}
        >
          {(user.fullName[0] ?? "?").toUpperCase()}
        </span>
      ))}
      {users.length > 3 ? <span className="ms-0.5 text-[10px]">+{users.length - 3}</span> : null}
    </span>
  );
}
