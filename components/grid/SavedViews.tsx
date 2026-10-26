"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, ChevronDown, Trash2 } from "lucide-react";
import { deleteView, listSavedViews, saveView, type SavedView } from "@/app/(app)/sheets/view-actions";
import type { SheetView } from "@/lib/sheets/view";

type ViewPart = Pick<SheetView, "search" | "filters" | "sort" | "mine" | "today">;

/** Google Sheets-style filter views: name the current search/filter/sort and share it with the tab. */
export function SavedViews({
  sheetId,
  current,
  canSave,
  onApply,
}: {
  sheetId: string;
  current: ViewPart;
  canSave: boolean;
  onApply: (view: Partial<SheetView>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const reload = () => void listSavedViews(sheetId).then(setViews);

  useEffect(() => {
    if (!open) {
      return;
    }
    void listSavedViews(sheetId).then(setViews);
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setNaming(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, sheetId]);

  const empty = !current.search && current.filters.length === 0 && !current.sort && !current.mine && !current.today;

  async function save() {
    const result = await saveView({ sheetId, name, view: current });
    if (result.error) {
      setError(result.error);
      return;
    }
    setNaming(false);
    setName("");
    setError("");
    setApplied(name.trim());
    reload();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        className={`inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 hover:bg-row ${applied ? "bg-primary/10 text-primary" : "text-muted hover:text-text"}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Bookmark className="size-4" aria-hidden="true" />
        <span className="max-w-32 truncate" dir="auto">
          {applied ?? "Views"}
        </span>
        <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
      </button>
      {open ? (
        <div role="menu" className="absolute start-0 top-full z-40 mt-1 w-64 rounded-lg border border-border bg-surface p-1 text-sm shadow-xl" dir="ltr">
          <p className="px-2 py-1 text-xs text-muted">Saved views on this tab, shared with everyone who opens it.</p>
          {views === null ? <p className="px-2 py-1.5 text-muted">Loading…</p> : null}
          {views?.length === 0 ? <p className="px-2 py-1.5 text-muted">No saved views yet.</p> : null}
          {views?.map((item) => (
            <div key={item.id} className="group flex items-center rounded-md hover:bg-row">
              <button
                type="button"
                role="menuitem"
                className="min-w-0 flex-1 cursor-pointer px-2 py-1.5 text-start"
                onClick={() => {
                  onApply(item.view as Partial<SheetView>);
                  setApplied(item.name);
                  setOpen(false);
                }}
              >
                <span dir="auto" className="block truncate">{item.name}</span>
                {item.createdByName ? <span className="block truncate text-[11px] text-muted">by {item.createdByName}</span> : null}
              </button>
              {item.canDelete ? (
                <button
                  type="button"
                  aria-label={`Delete view ${item.name}`}
                  className="me-1 cursor-pointer rounded p-1 text-muted opacity-0 hover:text-danger group-hover:opacity-100"
                  onClick={() => void deleteView({ sheetId, viewId: item.id }).then(reload)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
          <div className="my-1 border-t border-border" />
          {applied ? (
            <button
              type="button"
              role="menuitem"
              className="w-full cursor-pointer rounded-md px-2 py-1.5 text-start hover:bg-row"
              onClick={() => {
                onApply({});
                setApplied(null);
                setOpen(false);
              }}
            >
              Back to the default view
            </button>
          ) : null}
          {canSave ? (
            naming ? (
              <div className="p-1">
                <input
                  autoFocus
                  dir="auto"
                  value={name}
                  maxLength={60}
                  placeholder="View name, e.g. My stuck items"
                  aria-label="View name"
                  className="w-full rounded-md border border-border bg-surface px-2 py-1 outline-none focus:border-primary"
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void save();
                    } else if (event.key === "Escape") {
                      setNaming(false);
                    }
                  }}
                />
                {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
                <button
                  type="button"
                  disabled={!name.trim()}
                  className="mt-1 w-full cursor-pointer rounded-md bg-primary px-2 py-1 font-medium text-white disabled:opacity-50"
                  onClick={() => void save()}
                >
                  Save view
                </button>
              </div>
            ) : (
              <button
                type="button"
                role="menuitem"
                disabled={empty}
                title={empty ? "Search, filter or sort first, then save it as a view" : undefined}
                className="w-full cursor-pointer rounded-md px-2 py-1.5 text-start text-primary hover:bg-row disabled:cursor-not-allowed disabled:text-muted"
                onClick={() => setNaming(true)}
              >
                Save current view…
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
