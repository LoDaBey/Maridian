"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, LayoutDashboard, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { ChartBody } from "@/components/charts/Charts";
import { rangeCaption } from "@/components/charts/ChartSettings";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { DashboardSource, WidgetView } from "@/lib/dashboards/repo";
import { deleteWidgetAction, moveWidgetAction } from "@/app/(app)/w/[workspaceId]/dashboard/actions";
import { WidgetEditor } from "./WidgetEditor";

const REFRESH_MS = 60_000;

export function Dashboard({
  workspace,
  widgets,
  sources,
  canEdit,
}: {
  workspace: { id: string; name: string };
  widgets: WidgetView[];
  sources: DashboardSource[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [editing, setEditing] = useState<WidgetView | "new" | null>(null);
  const [removing, setRemoving] = useState<WidgetView | null>(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(() => new Date());

  useEffect(() => {
    // Numbers come from the server; refresh them while the tab is visible.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        startRefresh(() => router.refresh());
      }
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- stamp when new server data arrives
    setUpdatedAt(new Date());
  }, [widgets]);

  async function run(task: () => Promise<{ error: string }>) {
    setError("");
    const result = await task();
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            Live numbers from the sheets in {workspace.name}. Each person only sees data from sheets they can open.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">
            Updated {updatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </span>
          <button
            type="button"
            aria-label="Refresh dashboard"
            className="cursor-pointer rounded-lg border border-border bg-surface p-2 text-muted hover:text-text"
            onClick={() => startRefresh(() => router.refresh())}
          >
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>
          {canEdit ? (
            <button
              type="button"
              disabled={sources.length === 0}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white disabled:opacity-60"
              onClick={() => setEditing("new")}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add widget
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {widgets.length === 0 ? (
        <div className="mt-10 flex flex-col items-center rounded-lg border border-dashed border-border px-6 py-14 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <LayoutDashboard className="size-6" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-semibold">No widgets yet</h2>
          <p className="mt-1 max-w-md text-sm text-muted">
            {sources.length === 0
              ? "There are no sheets in this workspace you can open yet."
              : canEdit
                ? "Add a widget to track reports by status, editor, type or over time, across every tab of a sheet."
                : "A workspace admin or project manager can add widgets here."}
          </p>
          {canEdit && sources.length > 0 ? (
            <button
              type="button"
              className="mt-5 cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
              onClick={() => setEditing("new")}
            >
              Add your first widget
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {widgets.map((widget, index) => (
            <section
              key={widget.id}
              aria-label={widget.title}
              className={`flex min-h-56 flex-col rounded-lg border border-border bg-surface p-4 ${
                widget.config.spec.kind === "time" ? "lg:col-span-2" : ""
              }`}
            >
              <header className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 dir="auto" className="truncate text-sm font-semibold">
                    {widget.title}
                  </h2>
                  <p dir="auto" className="truncate text-xs text-muted">
                    {widget.sheetNames.join(", ") || "No sheets you can open"}
                    {widget.hiddenSheets > 0 ? ` · ${widget.hiddenSheets} sheet${widget.hiddenSheets === 1 ? "" : "s"} hidden from you` : ""}
                  </p>
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 gap-0.5 text-muted">
                    <button
                      type="button"
                      aria-label={`Move ${widget.title} earlier`}
                      disabled={index === 0}
                      className="cursor-pointer rounded-md p-1.5 hover:bg-row hover:text-text disabled:cursor-default disabled:opacity-30"
                      onClick={() => void run(() => moveWidgetAction({ workspaceId: workspace.id, widgetId: widget.id, direction: -1 }))}
                    >
                      <ArrowUp className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${widget.title} later`}
                      disabled={index === widgets.length - 1}
                      className="cursor-pointer rounded-md p-1.5 hover:bg-row hover:text-text disabled:cursor-default disabled:opacity-30"
                      onClick={() => void run(() => moveWidgetAction({ workspaceId: workspace.id, widgetId: widget.id, direction: 1 }))}
                    >
                      <ArrowDown className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Edit ${widget.title}`}
                      className="cursor-pointer rounded-md p-1.5 hover:bg-row hover:text-text"
                      onClick={() => setEditing(widget)}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${widget.title}`}
                      className="cursor-pointer rounded-md p-1.5 hover:bg-row hover:text-danger"
                      onClick={() => setRemoving(widget)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </header>
              <div className="min-h-0 flex-1">
                <ChartBody
                  kind={widget.config.spec.kind}
                  result={widget.result}
                  metric={widget.config.spec.metric}
                  groupLabel={widget.config.spec.groupBy?.name ?? ""}
                  caption={rangeCaption(widget.config.spec, widget.result.rowCount)}
                />
              </div>
            </section>
          ))}
        </div>
      )}

      {editing ? (
        <WidgetEditor
          workspaceId={workspace.id}
          widget={editing === "new" ? null : editing}
          sources={sources}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.title ?? "widget"}?`}
        message="It disappears from the dashboard for everyone. The sheets aren't affected."
        confirmLabel="Remove"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (target) {
            void run(() => deleteWidgetAction({ workspaceId: workspace.id, widgetId: target.id }));
          }
        }}
      />
    </main>
  );
}
