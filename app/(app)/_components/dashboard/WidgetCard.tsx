"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Download, GripVertical, Maximize2, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { drillWidget, loadWidgetData } from "@/app/(app)/w/[workspaceId]/dashboards/actions";
import { WIDGETS, type DashboardFilters } from "@/lib/analytics/widgets";
import type { DashboardWidget, WidgetData } from "@/lib/dashboards/repo";
import { ItemListChart } from "@/components/charts/TableCharts";
import { widgetCsv, WidgetRenderer } from "./WidgetRenderer";

export const ROW_HEIGHT: Record<number, number> = { 1: 168, 2: 344, 3: 520 };
/** Space taken by the card header and footer. */
const CHROME = 90;

const SIZES: Array<{ label: string; width: number }> = [
  { label: "Small (¼)", width: 3 },
  { label: "Third (⅓)", width: 4 },
  { label: "Half (½)", width: 6 },
  { label: "Two thirds (⅔)", width: 8 },
  { label: "Full width", width: 12 },
];

export function WidgetCard({
  workspaceId,
  dashboardId,
  widget,
  filters,
  refreshKey,
  canEdit,
  editing,
  onEdit,
  onDuplicate,
  onRemove,
  onResize,
  dragProps,
}: {
  workspaceId: string;
  dashboardId: string;
  widget: DashboardWidget;
  filters: DashboardFilters;
  refreshKey: number;
  canEdit: boolean;
  editing: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onResize: (width: number, height: number) => void;
  dragProps?: React.HTMLAttributes<HTMLElement>;
}) {
  const [data, setData] = useState<WidgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState(false);
  const [full, setFull] = useState(false);
  const [drill, setDrill] = useState<{ title: string; data: WidgetData | null } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show the loading state for a new request
    setLoading(true);
    void loadWidgetData({ workspaceId, dashboardId, widgetId: widget.id, filters: JSON.parse(filtersKey) as DashboardFilters })
      .then((next) => {
        if (!cancelled) {
          setData(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData({ type: "empty", message: "Couldn't load this widget. Try refreshing." });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, dashboardId, widget.id, widget.config, filtersKey, refreshKey]);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const onDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenu(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menu]);

  const onDrill = useCallback(
    (k1: string, k2?: string) => {
      const bucket = data?.type === "agg" ? data.result.buckets.find((item) => item.key === k1)?.label : undefined;
      const series = data?.type === "agg" && k2 !== undefined ? data.result.series.find((item) => item.key === k2)?.label : undefined;
      setDrill({ title: [bucket ?? k1, series].filter(Boolean).join(" · "), data: null });
      void drillWidget({ workspaceId, dashboardId, widgetId: widget.id, filters, k1, k2 }).then((result) =>
        setDrill((current) => (current ? { ...current, data: result } : current)),
      );
    },
    [data, workspaceId, dashboardId, widget.id, filters],
  );

  function exportCsv() {
    if (!data) {
      return;
    }
    const blob = new Blob([widgetCsv(widget.config, data)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${widget.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "widget"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const spec = WIDGETS[widget.config.kind];
  const chartHeight = (ROW_HEIGHT[widget.height] ?? 344) - CHROME;
  const caption =
    data?.type === "agg"
      ? `${data.result.rowCount.toLocaleString("en-US")} items${data.result.truncated ? " · partial (took too long)" : ""}`
      : data?.type === "list" || data?.type === "scatter"
        ? `${data.rowCount.toLocaleString("en-US")} items`
        : "";

  const body = (height: number) =>
    loading && !data ? (
      <div className="h-full w-full animate-pulse rounded-md bg-row" style={{ height }} />
    ) : data ? (
      <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
        <WidgetRenderer config={widget.config} data={data} height={height} onDrill={widget.config.kind === "item_list" ? undefined : onDrill} />
      </div>
    ) : null;

  return (
    <section
      aria-label={widget.title}
      className={`group relative flex flex-col rounded-xl border bg-surface p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-shadow hover:shadow-md ${
        editing ? "border-dashed border-primary/50" : "border-border"
      }`}
      style={{ height: ROW_HEIGHT[widget.height] ?? 344 }}
    >
      <header className="mb-2 flex items-start gap-2">
        {editing ? (
          <span {...dragProps} className="mt-0.5 cursor-grab text-muted active:cursor-grabbing" aria-label="Drag to reorder">
            <GripVertical className="size-4" aria-hidden="true" />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 dir="auto" title={widget.title} className="truncate text-sm font-semibold text-text">
            {widget.title}
          </h3>
          <p className="truncate text-xs text-muted">
            {spec.label}
            {caption ? ` · ${caption}` : ""}
          </p>
        </div>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label={`Options for ${widget.title}`}
            aria-expanded={menu}
            className="cursor-pointer rounded-md p-1 text-muted opacity-60 hover:bg-row hover:text-text group-hover:opacity-100"
            onClick={() => setMenu((value) => !value)}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
          {menu ? (
            <div role="menu" className="absolute end-0 top-full z-30 mt-1 w-52 rounded-lg border border-border bg-surface p-1 text-sm shadow-xl">
              <button type="button" role="menuitem" className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-row" onClick={() => { setMenu(false); setFull(true); }}>
                <Maximize2 className="size-4 text-muted" aria-hidden="true" /> Full screen
              </button>
              <button type="button" role="menuitem" className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-row" onClick={() => { setMenu(false); exportCsv(); }}>
                <Download className="size-4 text-muted" aria-hidden="true" /> Export CSV
              </button>
              {canEdit ? (
                <>
                  <button type="button" role="menuitem" className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-row" onClick={() => { setMenu(false); onEdit(); }}>
                    <Pencil className="size-4 text-muted" aria-hidden="true" /> Edit widget
                  </button>
                  <button type="button" role="menuitem" className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-row" onClick={() => { setMenu(false); onDuplicate(); }}>
                    <Copy className="size-4 text-muted" aria-hidden="true" /> Duplicate
                  </button>
                  <div className="my-1 border-t border-border" />
                  <p className="px-2 py-1 text-xs text-muted">Width</p>
                  {SIZES.map((size) => (
                    <button
                      key={size.width}
                      type="button"
                      role="menuitemradio"
                      aria-checked={widget.width === size.width}
                      className={`flex w-full cursor-pointer items-center rounded-md px-2 py-1 hover:bg-row ${widget.width === size.width ? "font-medium text-primary" : ""}`}
                      onClick={() => { setMenu(false); onResize(size.width, widget.height); }}
                    >
                      {size.label}
                    </button>
                  ))}
                  <p className="px-2 py-1 text-xs text-muted">Height</p>
                  <div className="flex gap-1 px-2 pb-1">
                    {[1, 2, 3].map((height) => (
                      <button
                        key={height}
                        type="button"
                        aria-pressed={widget.height === height}
                        className={`flex-1 cursor-pointer rounded-md border px-2 py-1 text-xs ${widget.height === height ? "border-primary text-primary" : "border-border hover:bg-row"}`}
                        onClick={() => { setMenu(false); onResize(widget.width, height); }}
                      >
                        {height === 1 ? "Short" : height === 2 ? "Medium" : "Tall"}
                      </button>
                    ))}
                  </div>
                  <div className="my-1 border-t border-border" />
                  <button type="button" role="menuitem" className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-danger hover:bg-danger/10" onClick={() => { setMenu(false); onRemove(); }}>
                    <Trash2 className="size-4" aria-hidden="true" /> Remove
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{body(chartHeight)}</div>

      {full
        ? createPortal(
            <div className="fixed inset-0 z-50 flex flex-col bg-bg p-6" role="dialog" aria-label={widget.title}>
              <div className="mb-4 flex items-center justify-between">
                <h2 dir="auto" className="text-xl font-semibold">{widget.title}</h2>
                <button type="button" aria-label="Close full screen" className="cursor-pointer rounded-md p-2 hover:bg-row" onClick={() => setFull(false)}>
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
              <div className="min-h-0 flex-1 rounded-xl border border-border bg-surface p-6">{body(Math.max(300, window.innerHeight - 180))}</div>
            </div>,
            document.body,
          )
        : null}

      {drill
        ? createPortal(
            <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setDrill(null)}>
              <aside
                role="dialog"
                aria-label={`Items: ${drill.title}`}
                className="flex h-full w-full max-w-2xl flex-col bg-surface p-5 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-muted">{widget.title}</p>
                    <h2 dir="auto" className="truncate text-lg font-semibold">{drill.title}</h2>
                  </div>
                  <button type="button" aria-label="Close" className="cursor-pointer rounded-md p-1.5 hover:bg-row" onClick={() => setDrill(null)}>
                    <X className="size-5" aria-hidden="true" />
                  </button>
                </div>
                <div className="min-h-0 flex-1">
                  {drill.data?.type === "list" ? (
                    <ItemListChart columns={drill.data.columns} items={drill.data.items} rowCount={drill.data.rowCount} height={window.innerHeight - 140} />
                  ) : drill.data ? (
                    <p className="text-sm text-muted">{drill.data.type === "empty" ? drill.data.message : "No items."}</p>
                  ) : (
                    <div className="h-40 animate-pulse rounded-md bg-row" />
                  )}
                </div>
              </aside>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
