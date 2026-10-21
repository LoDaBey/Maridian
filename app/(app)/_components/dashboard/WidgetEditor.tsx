"use client";

import { useMemo, useState } from "react";
import { ChartSettings, defaultSpec, reconcileSpec, uniqueRefs } from "@/components/charts/ChartSettings";
import type { ChartSpec } from "@/lib/charts/aggregate";
import type { DashboardSource, WidgetView } from "@/lib/dashboards/repo";
import { saveWidgetAction } from "@/app/(app)/w/[workspaceId]/dashboard/actions";

function autoTitle(spec: ChartSpec): string {
  if (spec.kind === "number") {
    return spec.metric.op === "count" ? "Total items" : `${spec.metric.op === "sum" ? "Total" : "Average"} ${spec.metric.column.name}`;
  }
  if (spec.kind === "time") {
    return `Items per ${spec.bucket}`;
  }
  return `Items by ${spec.groupBy?.name ?? "…"}`;
}

export function WidgetEditor({
  workspaceId,
  widget,
  sources,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  widget: WidgetView | null;
  sources: DashboardSource[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(
    widget?.config.workbookIds ?? (sources[0] ? [sources[0].id] : []),
  );
  const columns = useMemo(
    () => uniqueRefs(sources.filter((source) => selected.includes(source.id)).flatMap((source) => source.columns)),
    [sources, selected],
  );
  const [spec, setSpec] = useState<ChartSpec>(() => widget?.config.spec ?? defaultSpec(columns));
  const [title, setTitle] = useState(widget?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(Boolean(widget));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const shownTitle = titleTouched ? title : autoTitle(spec);
  const validSpec = reconcileSpec(spec, columns);

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function save() {
    setPending(true);
    setError("");
    try {
      const result = await saveWidgetAction({
        workspaceId,
        widgetId: widget?.id,
        title: shownTitle,
        config: { workbookIds: selected, spec: validSpec },
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      onSaved();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-labelledby="widget-editor-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface p-5 text-sm shadow-xl"
      >
        <h2 id="widget-editor-title" className="text-base font-semibold">
          {widget ? "Edit widget" : "Add widget"}
        </h2>
        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-auto pe-1">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Title</span>
            <input
              value={shownTitle}
              maxLength={100}
              dir="auto"
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 outline-none focus:border-primary"
              onChange={(event) => {
                setTitleTouched(true);
                setTitle(event.target.value);
              }}
            />
          </label>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-muted">Sheets (every tab is included)</legend>
            <ul className="max-h-40 space-y-0.5 overflow-auto rounded-md border border-border p-1">
              {sources.map((source) => (
                <li key={source.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-row">
                    <input
                      type="checkbox"
                      checked={selected.includes(source.id)}
                      aria-label={`Use ${source.name}`}
                      className="size-4 accent-primary"
                      onChange={() => toggle(source.id)}
                    />
                    <span dir="auto" className="flex-1 truncate">
                      {source.name}
                    </span>
                    <span className="text-xs text-muted">
                      {source.tabCount} tab{source.tabCount === 1 ? "" : "s"}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          {selected.length > 0 ? (
            <ChartSettings spec={validSpec} columns={columns} onChange={setSpec} />
          ) : (
            <p className="text-muted">Choose at least one sheet to pick its columns.</p>
          )}
          {selected.length > 1 ? (
            <p className="text-xs text-muted">
              Columns with the same name and type are combined across sheets and tabs.
            </p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={pending} className="cursor-pointer rounded-md px-3 py-1.5 hover:bg-row" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={pending || selected.length === 0}
            className="cursor-pointer rounded-md bg-primary px-3 py-1.5 font-medium text-white disabled:opacity-60"
            onClick={() => void save()}
          >
            {pending ? "Saving…" : widget ? "Save" : "Add widget"}
          </button>
        </div>
      </div>
    </div>
  );
}
