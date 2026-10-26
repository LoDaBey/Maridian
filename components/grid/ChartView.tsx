"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, Settings2, Trash2 } from "lucide-react";
import { ChartBody } from "@/components/charts/Charts";
import {
  ChartSettings,
  defaultSpec,
  KIND_LABEL,
  preferredGroup,
  rangeCaption,
  reconcileSpec,
  uniqueRefs,
  withKind,
} from "@/components/charts/ChartSettings";
import {
  aggregate,
  CHART_KINDS,
  metricLabel,
  type ChartKind,
  type ChartSpec,
  type ChartTable,
  type ColumnRef,
} from "@/lib/charts/aggregate";
import type { LocalColumn, LocalRow } from "@/lib/sheets/apply-local";

const MAX_CHARTS = 6;

interface SavedChart {
  id: string;
  spec: ChartSpec;
}

function storageKey(sheetId: string): string {
  return `monitor:charts:${sheetId}`;
}

function isSpec(value: unknown): value is ChartSpec {
  return (
    typeof value === "object" &&
    value !== null &&
    CHART_KINDS.includes((value as ChartSpec).kind) &&
    typeof (value as ChartSpec).metric === "object"
  );
}

/** The person's saved layout, or null when they haven't customised this sheet's charts. */
function loadSaved(sheetId: string): SavedChart[] | null {
  try {
    const raw = window.localStorage.getItem(storageKey(sheetId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      const charts = parsed.filter(
        (item): item is SavedChart => typeof item?.id === "string" && isSpec(item?.spec),
      );
      if (charts.length > 0) {
        return charts;
      }
    }
  } catch {
    // Unreadable storage falls back to the default charts.
  }
  return null;
}

function starterCharts(columns: ColumnRef[], preferred: ColumnRef | null): SavedChart[] {
  const first = defaultSpec(columns, preferred);
  // Stable ids, so the starter set can be re-derived as columns load.
  const charts: SavedChart[] = [{ id: "starter-status", spec: first }];
  const person = columns.find((column) => column.type === "person" || column.type === "created_by");
  if (person) {
    charts.push({ id: "starter-person", spec: { ...first, kind: "bar", groupBy: person } });
  }
  const date = columns.find((column) => column.type === "date" || column.type === "created_at");
  if (date) {
    charts.push({ id: "starter-date", spec: { ...first, kind: "time", groupBy: date, bucket: "week" } });
  }
  return charts;
}

function chartTitle(spec: ChartSpec): string {
  if (spec.kind === "number") {
    return metricLabel(spec.metric);
  }
  const by = spec.groupBy?.name ?? "—";
  return spec.metric.op === "count" ? `Items by ${by}` : `${metricLabel(spec.metric)} by ${by}`;
}

export function ChartView({
  sheetId,
  columns,
  rows,
  rowIds,
  usersById,
}: {
  sheetId: string;
  columns: LocalColumn[];
  rows: Record<string, LocalRow>;
  /** Rows the current filters show, in order. */
  rowIds: string[];
  usersById: ReadonlyMap<string, string>;
}) {
  const refs = useMemo(() => uniqueRefs(columns), [columns]);
  const preferred = useMemo(() => preferredGroup(columns), [columns]);
  const [saved, setSaved] = useState<SavedChart[] | null>(() => loadSaved(sheetId));
  // Saved charts are kept valid as columns change; starters follow the columns until edited.
  const charts = useMemo(
    () =>
      saved
        ? saved.map((chart) => ({ ...chart, spec: reconcileSpec(chart.spec, refs) }))
        : starterCharts(refs, preferred),
    [saved, refs, preferred],
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!picking) {
      return;
    }
    const onDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setPicking(false);
      }
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setPicking(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [picking]);

  const table = useMemo<ChartTable>(
    () => ({
      columns: columns.map((column) => ({ id: column.id, name: column.name, type: column.type, settings: column.settings })),
      rows: rowIds.flatMap((id) => {
        const row = rows[id];
        return row
          ? [{ data: row.data, createdBy: row.createdBy, createdAt: row.createdAt, updatedAt: row.updatedAt }]
          : [];
      }),
    }),
    [columns, rows, rowIds],
  );

  function save(next: SavedChart[]) {
    setSaved(next);
    try {
      window.localStorage.setItem(storageKey(sheetId), JSON.stringify(next));
    } catch {
      // Storage can be full or blocked; the charts still work for this visit.
    }
  }

  function update(id: string, spec: ChartSpec) {
    save(charts.map((chart) => (chart.id === id ? { ...chart, spec } : chart)));
  }

  /** Adds a chart of the picked type; its options open from the gear icon. */
  function add(kind: ChartKind) {
    const chart = { id: crypto.randomUUID(), spec: withKind(defaultSpec(refs, preferred), kind, refs) };
    save([...charts, chart]);
    setPicking(false);
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-bg p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Charts use the {rowIds.length.toLocaleString("en-US")} item{rowIds.length === 1 ? "" : "s"} your filters show. Your layout is saved
          for you on this browser.
        </p>
        {charts.length < MAX_CHARTS ? (
          <div ref={pickerRef} className="relative shrink-0">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={picking}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:bg-row"
              onClick={() => setPicking((value) => !value)}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add chart
              <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
            </button>
            {picking ? (
              <div role="menu" aria-label="Chart type" className="absolute end-0 top-full z-30 mt-1 w-56 rounded-lg border border-border bg-surface p-1 text-sm shadow-xl">
                {(Object.keys(KIND_LABEL) as ChartKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="menuitem"
                    className="block w-full cursor-pointer rounded-md px-3 py-1.5 text-start hover:bg-row"
                    onClick={() => add(kind)}
                  >
                    {KIND_LABEL[kind]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {charts.map((chart) => {
          const result = aggregate([table], chart.spec, usersById);
          const open = editing === chart.id;
          return (
            <section
              key={chart.id}
              aria-label={chartTitle(chart.spec)}
              className="flex min-h-64 flex-col rounded-lg border border-border bg-surface p-4"
            >
              <header className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 dir="auto" className="truncate text-sm font-semibold">
                    {chartTitle(chart.spec)}
                  </h3>
                  <p className="text-xs text-muted">{KIND_LABEL[chart.spec.kind]}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label="Chart settings"
                    aria-pressed={open}
                    className={`cursor-pointer rounded-md p-1.5 hover:bg-row ${open ? "text-primary" : "text-muted"}`}
                    onClick={() => setEditing(open ? null : chart.id)}
                  >
                    <Settings2 className="size-4" aria-hidden="true" />
                  </button>
                  {charts.length > 1 ? (
                    <button
                      type="button"
                      aria-label="Remove chart"
                      className="cursor-pointer rounded-md p-1.5 text-muted hover:bg-row hover:text-danger"
                      onClick={() => save(charts.filter((item) => item.id !== chart.id))}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </header>
              {open ? (
                <div className="mb-4 rounded-md border border-border bg-bg p-3">
                  <ChartSettings spec={chart.spec} columns={refs} onChange={(spec) => update(chart.id, spec)} />
                </div>
              ) : null}
              <div className="min-h-0 flex-1">
                <ChartBody
                  kind={chart.spec.kind}
                  result={result}
                  metric={chart.spec.metric}
                  groupLabel={chart.spec.groupBy?.name ?? ""}
                  caption={rangeCaption(chart.spec, result.rowCount)}
                />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
