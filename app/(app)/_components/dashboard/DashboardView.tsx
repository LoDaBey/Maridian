"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, LayoutGrid, Maximize, Minimize, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  deleteDashboardAction,
  deleteWidgetAction,
  duplicateWidgetAction,
  layoutWidgetsAction,
  updateDashboardAction,
} from "@/app/(app)/w/[workspaceId]/dashboards/actions";
import type { DashboardFilters } from "@/lib/analytics/widgets";
import type { DashboardSource, DashboardSummary, DashboardWidget } from "@/lib/dashboards/repo";
import { FilterBar, type Person } from "./FilterBar";
import { NewDashboardDialog } from "./NewDashboardDialog";
import { WidgetCard } from "./WidgetCard";
import { WidgetEditor } from "./WidgetEditor";

const REFRESH_MS = 60_000;

function readFilters(dashboardId: string, fallback: DashboardFilters): DashboardFilters {
  try {
    const raw = window.localStorage.getItem(`meridian:dash-filters:${dashboardId}`);
    return raw ? (JSON.parse(raw) as DashboardFilters) : fallback;
  } catch {
    return fallback;
  }
}

function writeFilters(dashboardId: string, value: DashboardFilters) {
  try {
    window.localStorage.setItem(`meridian:dash-filters:${dashboardId}`, JSON.stringify(value));
  } catch {
    // Private mode: filters just won't be remembered.
  }
}

export function DashboardView({
  workspace,
  dashboards,
  dashboard,
  widgets: initialWidgets,
  sources,
  people,
  canEdit,
}: {
  workspace: { id: string; name: string };
  dashboards: DashboardSummary[];
  dashboard: DashboardSummary;
  widgets: DashboardWidget[];
  sources: DashboardSource[];
  people: Person[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [widgets, setWidgets] = useState(initialWidgets);
  const [syncedFrom, setSyncedFrom] = useState(initialWidgets);
  if (syncedFrom !== initialWidgets) {
    setSyncedFrom(initialWidgets);
    setWidgets(initialWidgets);
  }
  const [filters, setFiltersState] = useState<DashboardFilters>(dashboard.filters);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState<DashboardWidget | "new" | null>(null);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(dashboard.name);
  const [tv, setTv] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  const rootRef = useRef<HTMLDivElement>(null);

  // Per-viewer filters are remembered in this browser, starting from the dashboard's defaults.
  useEffect(() => {
    if (loadedFor === dashboard.id) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
    setFiltersState(readFilters(dashboard.id, dashboard.filters));
    setLoadedFor(dashboard.id);
  }, [dashboard.id, dashboard.filters, loadedFor]);

  const setFilters = (next: DashboardFilters) => {
    setFiltersState(next);
    writeFilters(dashboard.id, next);
  };

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1);
    setUpdatedAt(new Date());
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const onChange = () => setTv(document.fullscreenElement === rootRef.current && rootRef.current !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleTv() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void rootRef.current?.requestFullscreen().catch(() => setTv((value) => !value));
    }
  }

  async function persistOrder(next: DashboardWidget[]) {
    await layoutWidgetsAction({ workspaceId: workspace.id, dashboardId: dashboard.id, order: next.map((widget) => widget.id) });
  }

  function moveBefore(sourceId: string, targetId: string) {
    if (sourceId === targetId) {
      return;
    }
    setWidgets((current) => {
      const from = current.findIndex((widget) => widget.id === sourceId);
      const to = current.findIndex((widget) => widget.id === targetId);
      if (from < 0 || to < 0) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  }

  async function resize(widget: DashboardWidget, width: number, height: number) {
    setWidgets((current) => current.map((item) => (item.id === widget.id ? { ...item, width, height } : item)));
    await layoutWidgetsAction({ workspaceId: workspace.id, dashboardId: dashboard.id, resize: { widgetId: widget.id, width, height } });
  }

  async function remove(widget: DashboardWidget) {
    if (!window.confirm(`Remove “${widget.title}” from this dashboard?`)) {
      return;
    }
    setWidgets((current) => current.filter((item) => item.id !== widget.id));
    await deleteWidgetAction({ workspaceId: workspace.id, dashboardId: dashboard.id, widgetId: widget.id });
    router.refresh();
  }

  async function duplicate(widget: DashboardWidget) {
    await duplicateWidgetAction({ workspaceId: workspace.id, dashboardId: dashboard.id, widgetId: widget.id });
    router.refresh();
  }

  async function rename() {
    setRenaming(false);
    if (name.trim() && name.trim() !== dashboard.name) {
      await updateDashboardAction({ workspaceId: workspace.id, dashboardId: dashboard.id, name: name.trim() });
      router.refresh();
    } else {
      setName(dashboard.name);
    }
  }

  async function removeDashboard() {
    if (!window.confirm(`Delete the dashboard “${dashboard.name}” and its ${widgets.length} widgets? The sheets aren't touched.`)) {
      return;
    }
    await deleteDashboardAction({ workspaceId: workspace.id, dashboardId: dashboard.id });
    router.push(`/w/${workspace.id}/dashboards`);
    router.refresh();
  }

  const button = "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-row";

  return (
    <div ref={rootRef} className={`min-h-full bg-bg ${tv ? "overflow-auto p-6" : "p-4 sm:p-6"}`}>
      {!tv ? (
        <nav aria-label="Dashboards" className="mb-4 flex items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border">
          {dashboards.map((item) => (
            <Link
              key={item.id}
              href={`/w/${workspace.id}/dashboards/${item.id}`}
              aria-current={item.id === dashboard.id ? "page" : undefined}
              dir="auto"
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                item.id === dashboard.id ? "border-primary font-medium text-primary" : "border-transparent text-muted hover:text-text"
              }`}
            >
              {item.name}
            </Link>
          ))}
          {canEdit ? (
            <button type="button" className="ms-1 inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-sm text-muted hover:bg-row hover:text-text" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden="true" /> New dashboard
            </button>
          ) : null}
        </nav>
      ) : null}

      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">{workspace.name}</p>
          {renaming ? (
            <input
              autoFocus
              dir="auto"
              aria-label="Dashboard name"
              value={name}
              className="rounded-md border border-primary bg-surface px-2 text-2xl font-semibold outline-none"
              onChange={(event) => setName(event.target.value)}
              onBlur={() => void rename()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void rename();
                } else if (event.key === "Escape") {
                  setName(dashboard.name);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <h1 dir="auto" className="truncate text-2xl font-semibold tracking-tight">{dashboard.name}</h1>
          )}
          {dashboard.description ? <p className="mt-0.5 text-sm text-muted">{dashboard.description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden text-xs text-muted sm:inline" suppressHydrationWarning>
            Updated {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          <button type="button" className={button} onClick={refresh} aria-label="Refresh all widgets">
            <RefreshCw className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button type="button" className={button} onClick={toggleTv} aria-pressed={tv}>
            {tv ? <Minimize className="size-4" aria-hidden="true" /> : <Maximize className="size-4" aria-hidden="true" />}
            {tv ? "Exit TV mode" : "TV mode"}
          </button>
          {canEdit && !tv ? (
            <>
              <button type="button" className={`${button} ${editing ? "border-primary text-primary" : ""}`} aria-pressed={editing} onClick={() => setEditing((value) => !value)}>
                {editing ? <Check className="size-4" aria-hidden="true" /> : <LayoutGrid className="size-4" aria-hidden="true" />}
                {editing ? "Done" : "Arrange"}
              </button>
              <button type="button" className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90" onClick={() => setEditor("new")}>
                <Plus className="size-4" aria-hidden="true" /> Add widget
              </button>
              <div className="relative">
                <button type="button" aria-label="Dashboard options" aria-expanded={menu} className={`${button} px-2`} onClick={() => setMenu((value) => !value)}>
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </button>
                {menu ? (
                  <div role="menu" className="absolute end-0 top-full z-30 mt-1 w-56 rounded-lg border border-border bg-surface p-1 text-sm shadow-xl" onMouseLeave={() => setMenu(false)}>
                    <button type="button" role="menuitem" className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-row" onClick={() => { setMenu(false); setRenaming(true); }}>
                      <Pencil className="size-4 text-muted" aria-hidden="true" /> Rename
                    </button>
                    <button type="button" role="menuitem" className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-danger hover:bg-danger/10" onClick={() => { setMenu(false); void removeDashboard(); }}>
                      <Trash2 className="size-4" aria-hidden="true" /> Delete dashboard
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </header>

      <div className="mb-5">
        <FilterBar
          workspaceId={workspace.id}
          value={filters}
          onChange={setFilters}
          sources={sources}
          people={people}
          canSaveDefault={canEdit && !tv && JSON.stringify(filters) !== JSON.stringify(dashboard.filters)}
          onSaveDefault={() => void updateDashboardAction({ workspaceId: workspace.id, dashboardId: dashboard.id, filters }).then(() => router.refresh())}
        />
      </div>

      {widgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface px-6 py-16 text-center">
          <LayoutGrid className="mb-3 size-8 text-muted" aria-hidden="true" />
          <h2 className="text-lg font-semibold">This dashboard is empty</h2>
          <p className="mt-1 max-w-md text-sm text-muted">
            {canEdit ? "Add a widget to chart any column of your sheets: 24 chart types, each with its own filters." : "A workspace admin or project manager can add widgets here."}
          </p>
          {canEdit ? (
            <button type="button" className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90" onClick={() => setEditor("new")}>
              <Plus className="size-4" aria-hidden="true" /> Add widget
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-4">
          {widgets.map((widget) => (
            <div
              key={widget.id}
              className={`col-span-12 min-w-0 md:[grid-column:span_var(--w)/span_var(--w)] ${dragId === widget.id ? "opacity-40" : ""}`}
              style={{ "--w": widget.width } as React.CSSProperties}
              onDragOver={(event) => {
                if (dragId) {
                  event.preventDefault();
                  moveBefore(dragId, widget.id);
                }
              }}
              onDrop={(event) => event.preventDefault()}
            >
              <WidgetCard
                workspaceId={workspace.id}
                dashboardId={dashboard.id}
                widget={widget}
                filters={filters}
                refreshKey={refreshKey}
                canEdit={canEdit && !tv}
                editing={editing}
                onEdit={() => setEditor(widget)}
                onDuplicate={() => void duplicate(widget)}
                onRemove={() => void remove(widget)}
                onResize={(width, height) => void resize(widget, width, height)}
                dragProps={{
                  draggable: true,
                  onDragStart: (event) => {
                    event.dataTransfer.effectAllowed = "move";
                    setDragId(widget.id);
                  },
                  onDragEnd: () => {
                    setDragId(null);
                    void persistOrder(widgets);
                  },
                }}
              />
            </div>
          ))}
        </div>
      )}

      {editor ? (
        <WidgetEditor
          workspaceId={workspace.id}
          dashboardId={dashboard.id}
          widget={editor === "new" ? null : editor}
          sources={sources}
          filters={filters}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            router.refresh();
          }}
        />
      ) : null}
      {creating ? <NewDashboardDialog workspaceId={workspace.id} sources={sources} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
