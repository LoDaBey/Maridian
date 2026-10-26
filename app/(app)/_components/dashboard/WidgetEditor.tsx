"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, X } from "lucide-react";
import { getColumnValues, previewWidget, saveWidgetAction } from "@/app/(app)/w/[workspaceId]/dashboards/actions";
import {
  DATE_BUCKETS,
  DATE_RANGE_LABEL,
  DATE_RANGES,
  DATE_TYPES,
  GROUPABLE_TYPES,
  MEASURE_OPS,
  PERSON_TYPES,
  parseRefKey,
  refKey,
  type ColumnRef,
  type DateBucket,
  type Filter,
  type FilterOp,
  type Measure,
  type MeasureOp,
} from "@/lib/analytics/types";
import {
  defaultBucket,
  WIDGET_GROUPS,
  WIDGET_KINDS,
  WIDGETS,
  type DashboardFilters,
  type WidgetConfig,
  type WidgetKind,
} from "@/lib/analytics/widgets";
import type { DashboardSource, DashboardWidget, WidgetData } from "@/lib/dashboards/repo";
import { WidgetRenderer } from "./WidgetRenderer";

const SYSTEM_COLUMNS: ColumnRef[] = [
  { name: "Created at", type: "created_at" },
  { name: "Updated at", type: "updated_at" },
  { name: "Created by", type: "created_by" },
];

const MEASURE_LABEL: Record<MeasureOp, string> = {
  count: "Count of items",
  sum: "Sum of",
  avg: "Average of",
  min: "Minimum of",
  max: "Maximum of",
  distinct: "Number of different",
};

const OP_LABEL: Record<FilterOp, string> = {
  any_of: "is any of",
  none_of: "is none of",
  empty: "is empty",
  not_empty: "is not empty",
  contains: "contains",
  not_contains: "doesn't contain",
  eq: "=",
  gt: ">",
  lt: "<",
  between: "between",
  date_range: "is within",
  me: "is me",
  my_team: "is my team",
  checked: "is checked",
  unchecked: "is unchecked",
};

const BUCKET_LABEL: Record<DateBucket, string> = { day: "Day", week: "Week", month: "Month", quarter: "Quarter", year: "Year" };

function opsFor(ref: ColumnRef): FilterOp[] {
  if (DATE_TYPES.has(ref.type)) {
    return ["date_range", "empty", "not_empty"];
  }
  if (ref.type === "number" || ref.type === "rating" || ref.type === "progress") {
    return ["eq", "gt", "lt", "between", "empty", "not_empty"];
  }
  if (ref.type === "checkbox") {
    return ["checked", "unchecked"];
  }
  if (PERSON_TYPES.has(ref.type)) {
    return ["any_of", "none_of", "me", "my_team", "empty", "not_empty"];
  }
  if (["status", "priority", "dropdown", "tags", "country"].includes(ref.type)) {
    return ["any_of", "none_of", "empty", "not_empty"];
  }
  return ["contains", "not_contains", "any_of", "empty", "not_empty"];
}

function newFilter(ref: ColumnRef): Filter {
  const op = opsFor(ref)[0]!;
  return op === "date_range" ? { ref, op, range: "30d" } : op === "any_of" || op === "none_of" ? { ref, op, values: [] } : { ref, op };
}

function allowedForDim(kind: WidgetKind, index: number, ref: ColumnRef): boolean {
  const spec = WIDGETS[kind];
  if (index === 0 && spec.dateFirst) {
    return DATE_TYPES.has(ref.type);
  }
  if (index === 1 && spec.dateSecond) {
    return DATE_TYPES.has(ref.type);
  }
  if (index === 0 && spec.numberFirst) {
    return ref.type === "number" || ref.type === "rating" || ref.type === "progress";
  }
  if (index === 0 && spec.countryFirst) {
    return ref.type === "country";
  }
  if (index === 0 && kind === "workload") {
    return PERSON_TYPES.has(ref.type);
  }
  return GROUPABLE_TYPES.has(ref.type);
}

/** Default "group by" order: labels people group by before free text. */
const GROUP_PREFERENCE: ColumnRef["type"][] = ["status", "priority", "dropdown", "person", "country", "tags", "checkbox", "rating", "date", "due_date", "created_at", "created_by"];

const field = "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";
const label = "mb-1 block text-xs font-medium text-muted";

/** Picks sensible fields for a kind from the available columns. */
function fitConfig(config: WidgetConfig, kind: WidgetKind, columns: ColumnRef[]): WidgetConfig {
  const spec = WIDGETS[kind];
  const count = spec.dims === "none" ? 0 : spec.dims === "one" ? 1 : 2;
  const dims = [] as WidgetConfig["dims"];
  for (let index = 0; index < count; index += 1) {
    const current = config.dims[index];
    const free = columns.filter((column) => allowedForDim(kind, index, column) && !dims.some((dim) => refKey(dim.ref) === refKey(column)));
    const order = kind === "leaderboard" && index === 0 ? ["person", "created_by", ...GROUP_PREFERENCE] : GROUP_PREFERENCE;
    const keep = current && allowedForDim(kind, index, current.ref) && !(kind === "leaderboard" && index === 0 && !PERSON_TYPES.has(current.ref.type));
    const ref = keep
      ? current.ref
      : [...free].sort((a, b) => (order.indexOf(a.type) + 1 || 99) - (order.indexOf(b.type) + 1 || 99))[0];
    if (ref) {
      dims.push({ ref, bucket: DATE_TYPES.has(ref.type) ? (current?.bucket ?? defaultBucket(kind)) : undefined });
    }
  }
  const numbers = columns.filter((column) => column.type === "number");
  const options = { ...config.options };
  if (spec.xy) {
    options.x = options.x ?? numbers[0];
    options.y = options.y ?? numbers[1] ?? numbers[0];
  }
  if (kind === "gauge" && !options.goal) {
    options.goal = 100;
  }
  if (kind === "workload" && !options.capacity) {
    options.capacity = 50;
  }
  return { ...config, kind, dims, options };
}

function ValuePicker({
  workspaceId,
  workbookIds,
  filter,
  onChange,
}: {
  workspaceId: string;
  workbookIds: string[];
  filter: Filter;
  onChange: (values: string[]) => void;
}) {
  const [options, setOptions] = useState<Array<{ key: string; label: string; color?: string }> | null>(null);
  const key = `${refKey(filter.ref)}|${workbookIds.join(",")}`;
  useEffect(() => {
    let cancelled = false;
    void getColumnValues({ workspaceId, workbookIds, ref: filter.ref }).then((list) => {
      if (!cancelled) {
        setOptions(list);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures ref + sheets
  }, [workspaceId, key]);
  const values = filter.values ?? [];
  if (!options) {
    return <p className="text-xs text-muted">Loading values…</p>;
  }
  if (options.length === 0) {
    return <p className="text-xs text-muted">No values yet.</p>;
  }
  return (
    <div className="flex max-h-32 flex-wrap gap-1 overflow-auto">
      {options.map((option) => {
        const on = values.includes(option.key);
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={on}
            dir="auto"
            className={`inline-flex max-w-48 cursor-pointer items-center gap-1 truncate rounded-full border px-2 py-0.5 text-xs ${
              on ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-row"
            }`}
            onClick={() => onChange(on ? values.filter((value) => value !== option.key) : [...values, option.key])}
          >
            {option.color ? <span aria-hidden="true" className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: option.color }} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ColumnSelect({
  value,
  columns,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: ColumnRef | undefined;
  columns: ColumnRef[];
  onChange: (ref: ColumnRef | undefined) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      className={field}
      value={value ? refKey(value) : ""}
      onChange={(event) => onChange(parseRefKey(event.target.value) ?? undefined)}
    >
      <option value="">{placeholder ?? "Choose a column"}</option>
      {columns.map((column) => (
        <option key={refKey(column)} value={refKey(column)}>
          {column.name}
        </option>
      ))}
    </select>
  );
}

export function WidgetEditor({
  workspaceId,
  dashboardId,
  widget,
  sources,
  filters,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  dashboardId: string;
  widget: DashboardWidget | null;
  sources: DashboardSource[];
  filters: DashboardFilters;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(widget?.title ?? "");
  const [config, setConfig] = useState<WidgetConfig>(
    () =>
      widget?.config ?? {
        v: 2,
        kind: "bar",
        source: { workbookIds: sources[0] ? [sources[0].id] : [] },
        dims: [],
        measure: { op: "count" },
        filters: [],
        options: { labels: true },
      },
  );
  const [preview, setPreview] = useState<{ kind: WidgetKind; data: WidgetData } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const spec = WIDGETS[config.kind];

  const columns = useMemo(() => {
    const seen = new Set<string>();
    const list = sources
      .filter((source) => config.source.workbookIds.includes(source.id))
      .flatMap((source) => source.columns)
      .concat(SYSTEM_COLUMNS);
    return list.filter((column) => {
      const key = refKey(column);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [sources, config.source.workbookIds]);
  const numberColumns = columns.filter((column) => column.type === "number" || column.type === "rating" || column.type === "progress");

  // A new widget starts with fields that fit its kind once columns are known.
  const [fitted, setFitted] = useState(widget !== null);
  if (!fitted && columns.length > SYSTEM_COLUMNS.length) {
    setFitted(true);
    setConfig((current) => fitConfig(current, current.kind, columns));
  }

  const configKey = JSON.stringify(config);
  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPreviewing(true);
      const next = JSON.parse(configKey) as WidgetConfig;
      void previewWidget({ workspaceId, config: next, filters: JSON.parse(filtersKey) as DashboardFilters })
        .then((data) => {
          if (!cancelled) {
            setPreview({ kind: next.kind, data });
          }
        })
        .finally(() => {
          if (!cancelled) {
            setPreviewing(false);
          }
        });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [workspaceId, configKey, filtersKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const update = (patch: Partial<WidgetConfig>) => setConfig((current) => ({ ...current, ...patch }));
  const setOption = (patch: Partial<WidgetConfig["options"]>) => setConfig((current) => ({ ...current, options: { ...current.options, ...patch } }));

  function setDim(index: number, ref: ColumnRef | undefined) {
    setConfig((current) => {
      const dims = [...current.dims];
      if (!ref) {
        dims.splice(index, 1);
      } else {
        dims[index] = { ref, bucket: DATE_TYPES.has(ref.type) ? (dims[index]?.bucket ?? defaultBucket(current.kind)) : undefined };
      }
      return { ...current, dims };
    });
  }

  function setMeasure(op: MeasureOp, column?: ColumnRef) {
    const measure: Measure =
      op === "count"
        ? { op }
        : op === "distinct"
          ? { op, column: column ?? columns[0]! }
          : { op, column: column ?? numberColumns[0] ?? columns[0]! };
    update({ measure });
  }

  function setFilter(index: number, next: Filter | null) {
    setConfig((current) => ({
      ...current,
      filters: next ? current.filters.map((item, at) => (at === index ? next : item)) : current.filters.filter((_, at) => at !== index),
    }));
  }

  async function save() {
    setSaving(true);
    setError("");
    const result = await saveWidgetAction({
      workspaceId,
      dashboardId,
      widgetId: widget?.id,
      title: title.trim() || spec.label,
      config,
      width: widget ? undefined : spec.width,
      height: widget ? undefined : spec.height,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSaved();
  }

  const dimCount = spec.dims === "none" ? 0 : spec.dims === "one" ? 1 : 2;
  const dimLabels =
    config.kind === "workload"
      ? ["Person", "Period"]
      : spec.dateFirst
        ? ["Over time (date column)", "Split by"]
        : config.kind === "pivot" || config.kind === "matrix_heatmap"
          ? ["Rows", "Columns"]
          : ["Group by", "Split by"];
  const chosenSources = sources.filter((source) => config.source.workbookIds.includes(source.id));
  const dateColumns = columns.filter((column) => DATE_TYPES.has(column.type));
  const personColumns = columns.filter((column) => PERSON_TYPES.has(column.type));

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 p-0 sm:p-6" dir="ltr">
      <div role="dialog" aria-modal="true" aria-label={widget ? "Edit widget" : "Add widget"} className="flex w-full max-w-6xl flex-col overflow-hidden bg-surface shadow-2xl sm:rounded-2xl">
        <header className="flex items-center gap-3 border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold">{widget ? "Edit widget" : "Add widget"}</h2>
          <input
            value={title}
            placeholder={spec.label}
            aria-label="Widget title"
            dir="auto"
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-base hover:border-border focus:border-primary focus:outline-none"
            onChange={(event) => setTitle(event.target.value)}
          />
          <button type="button" aria-label="Close" className="cursor-pointer rounded-md p-1.5 hover:bg-row" onClick={onClose}>
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <div className="border-border p-5 lg:min-h-0 lg:w-[26rem] lg:shrink-0 lg:overflow-y-auto lg:border-e">
            <section className="mb-5">
              <h3 className="mb-2 text-sm font-semibold">Chart type</h3>
              {WIDGET_GROUPS.map((group) => (
                <div key={group} className="mb-2">
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">{group}</p>
                  <div className="flex flex-wrap gap-1">
                    {WIDGET_KINDS.filter((kind) => WIDGETS[kind].group === group).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        title={WIDGETS[kind].description}
                        aria-pressed={config.kind === kind}
                        className={`cursor-pointer rounded-md border px-2 py-1 text-xs ${
                          config.kind === kind ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:bg-row"
                        }`}
                        onClick={() => setConfig((current) => fitConfig(current, kind, columns))}
                      >
                        {WIDGETS[kind].label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="mt-1 text-xs text-muted">{spec.description}</p>
            </section>

            <section className="mb-5">
              <h3 className="mb-2 text-sm font-semibold">Data from</h3>
              <ul className="space-y-1">
                {sources.map((source) => {
                  const on = config.source.workbookIds.includes(source.id);
                  return (
                    <li key={source.id}>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={on}
                          onChange={() =>
                            update({
                              source: {
                                workbookIds: on ? config.source.workbookIds.filter((id) => id !== source.id) : [...config.source.workbookIds, source.id],
                                tabIds: config.source.tabIds?.filter((tabId) => !on || !source.tabs.some((tab) => tab.id === tabId)),
                              },
                            })
                          }
                        />
                        <span dir="auto" className="truncate">{source.name}</span>
                        <span className="text-xs text-muted">{source.tabs.length} tabs</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {chosenSources.some((source) => source.tabs.length > 1) ? (
                <div className="mt-2">
                  <p className={label}>Tabs (none selected = all tabs)</p>
                  <div className="flex flex-wrap gap-1">
                    {chosenSources.flatMap((source) =>
                      source.tabs.map((tab) => {
                        const on = config.source.tabIds?.includes(tab.id) ?? false;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            aria-pressed={on}
                            dir="auto"
                            className={`cursor-pointer rounded-full border px-2 py-0.5 text-xs ${on ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-row"}`}
                            onClick={() => {
                              const current = config.source.tabIds ?? [];
                              update({ source: { ...config.source, tabIds: on ? current.filter((id) => id !== tab.id) : [...current, tab.id] } });
                            }}
                          >
                            {chosenSources.length > 1 ? `${source.name} · ` : ""}
                            {tab.name}
                          </button>
                        );
                      }),
                    )}
                  </div>
                </div>
              ) : null}
            </section>

            {dimCount > 0 ? (
              <section className="mb-5 space-y-3">
                <h3 className="text-sm font-semibold">Fields</h3>
                {Array.from({ length: dimCount }, (_, index) => {
                  const dim = config.dims[index];
                  return (
                    <div key={index}>
                      <label className={label}>{dimLabels[index]}</label>
                      <div className="flex gap-2">
                        <ColumnSelect
                          ariaLabel={dimLabels[index]!}
                          value={dim?.ref}
                          columns={columns.filter((column) => allowedForDim(config.kind, index, column))}
                          onChange={(ref) => setDim(index, ref)}
                        />
                        {dim && DATE_TYPES.has(dim.ref.type) ? (
                          <select
                            aria-label="Period"
                            className={`${field} w-28 shrink-0`}
                            value={dim.bucket ?? "week"}
                            onChange={(event) =>
                              setConfig((current) => ({
                                ...current,
                                dims: current.dims.map((item, at) => (at === index ? { ...item, bucket: event.target.value as DateBucket } : item)),
                              }))
                            }
                          >
                            {DATE_BUCKETS.map((bucket) => (
                              <option key={bucket} value={bucket}>
                                {BUCKET_LABEL[bucket]}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </section>
            ) : null}

            {config.kind !== "scatter" && config.kind !== "item_list" ? (
              <section className="mb-5">
                <h3 className="mb-2 text-sm font-semibold">Value</h3>
                <div className="flex gap-2">
                  <select aria-label="Measure" className={`${field} w-44 shrink-0`} value={config.measure.op} onChange={(event) => setMeasure(event.target.value as MeasureOp)}>
                    {MEASURE_OPS.filter((op) => op === "count" || op === "distinct" || numberColumns.length > 0).map((op) => (
                      <option key={op} value={op}>
                        {MEASURE_LABEL[op]}
                      </option>
                    ))}
                  </select>
                  {config.measure.op !== "count" ? (
                    <ColumnSelect
                      ariaLabel="Measure column"
                      value={config.measure.column}
                      columns={config.measure.op === "distinct" ? columns : numberColumns}
                      onChange={(ref) => ref && setMeasure(config.measure.op, ref)}
                    />
                  ) : null}
                </div>
              </section>
            ) : null}

            <section className="mb-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Filters</h3>
                <select
                  aria-label="Add filter"
                  className="cursor-pointer rounded-md border border-border bg-surface px-2 py-1 text-xs"
                  value=""
                  onChange={(event) => {
                    const ref = parseRefKey(event.target.value);
                    if (ref) {
                      update({ filters: [...config.filters, newFilter(ref)] });
                    }
                  }}
                >
                  <option value="">+ Add filter</option>
                  {columns.map((column) => (
                    <option key={refKey(column)} value={refKey(column)}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </div>
              {config.filters.length === 0 ? <p className="text-xs text-muted">No filters: every item counts.</p> : null}
              <ul className="space-y-2">
                {config.filters.map((filter, index) => (
                  <li key={`${refKey(filter.ref)}-${index}`} className="rounded-lg border border-border p-2">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span dir="auto" className="min-w-0 flex-1 truncate text-sm font-medium">{filter.ref.name}</span>
                      <select
                        aria-label="Condition"
                        className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs"
                        value={filter.op}
                        onChange={(event) => {
                          const op = event.target.value as FilterOp;
                          setFilter(index, op === "date_range" ? { ref: filter.ref, op, range: filter.range ?? "30d" } : { ref: filter.ref, op, values: op === "any_of" || op === "none_of" ? (filter.values ?? []) : undefined });
                        }}
                      >
                        {opsFor(filter.ref).map((op) => (
                          <option key={op} value={op}>
                            {OP_LABEL[op]}
                          </option>
                        ))}
                      </select>
                      <button type="button" aria-label={`Remove ${filter.ref.name} filter`} className="cursor-pointer rounded p-1 text-muted hover:bg-row hover:text-danger" onClick={() => setFilter(index, null)}>
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    {filter.op === "any_of" || filter.op === "none_of" ? (
                      <ValuePicker workspaceId={workspaceId} workbookIds={config.source.workbookIds} filter={filter} onChange={(values) => setFilter(index, { ...filter, values })} />
                    ) : filter.op === "contains" || filter.op === "not_contains" ? (
                      <input aria-label="Text" className={field} value={String(filter.value ?? "")} onChange={(event) => setFilter(index, { ...filter, value: event.target.value })} />
                    ) : filter.op === "eq" || filter.op === "gt" || filter.op === "lt" ? (
                      <input type="number" aria-label="Number" className={field} value={filter.value ?? ""} onChange={(event) => setFilter(index, { ...filter, value: event.target.value === "" ? undefined : Number(event.target.value) })} />
                    ) : filter.op === "between" ? (
                      <div className="flex items-center gap-1">
                        <input type="number" aria-label="Minimum" className={field} value={filter.min ?? ""} onChange={(event) => setFilter(index, { ...filter, min: event.target.value === "" ? undefined : Number(event.target.value) })} />
                        <span className="text-muted">–</span>
                        <input type="number" aria-label="Maximum" className={field} value={filter.max ?? ""} onChange={(event) => setFilter(index, { ...filter, max: event.target.value === "" ? undefined : Number(event.target.value) })} />
                      </div>
                    ) : filter.op === "date_range" ? (
                      <div className="flex flex-wrap items-center gap-1">
                        <select aria-label="Range" className={`${field} w-auto`} value={filter.range ?? "30d"} onChange={(event) => setFilter(index, { ...filter, range: event.target.value as Filter["range"] })}>
                          {DATE_RANGES.filter((range) => range !== "all").map((range) => (
                            <option key={range} value={range}>
                              {DATE_RANGE_LABEL[range]}
                            </option>
                          ))}
                        </select>
                        {filter.range === "custom" ? (
                          <>
                            <input type="date" aria-label="From" className={`${field} w-auto`} value={filter.from ?? ""} onChange={(event) => setFilter(index, { ...filter, from: event.target.value || undefined })} />
                            <input type="date" aria-label="To" className={`${field} w-auto`} value={filter.to ?? ""} onChange={(event) => setFilter(index, { ...filter, to: event.target.value || undefined })} />
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Options</h3>
              {spec.xy ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={label}>Across (X)</label>
                    <ColumnSelect ariaLabel="X column" value={config.options.x} columns={numberColumns} onChange={(x) => setOption({ x })} />
                  </div>
                  <div>
                    <label className={label}>Up (Y)</label>
                    <ColumnSelect ariaLabel="Y column" value={config.options.y} columns={numberColumns} onChange={(y) => setOption({ y })} />
                  </div>
                </div>
              ) : null}
              {config.kind === "item_list" ? (
                <div>
                  <label className={label}>Columns to show (none = first 5)</label>
                  <div className="flex flex-wrap gap-1">
                    {columns.map((column) => {
                      const on = config.options.listColumns?.some((item) => refKey(item) === refKey(column)) ?? false;
                      return (
                        <button
                          key={refKey(column)}
                          type="button"
                          aria-pressed={on}
                          dir="auto"
                          className={`cursor-pointer rounded-full border px-2 py-0.5 text-xs ${on ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-row"}`}
                          onClick={() => {
                            const current = config.options.listColumns ?? [];
                            setOption({ listColumns: on ? current.filter((item) => refKey(item) !== refKey(column)) : [...current, column] });
                          }}
                        >
                          {column.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {dimCount > 0 && !spec.dateFirst && config.kind !== "workload" ? (
                <div>
                  <label className={label} htmlFor="widget-topn">Show the top</label>
                  <select id="widget-topn" className={field} value={config.options.topN ?? ""} onChange={(event) => setOption({ topN: event.target.value ? Number(event.target.value) : undefined })}>
                    <option value="">Everything</option>
                    {[5, 8, 10, 15, 20, 30].map((count) => (
                      <option key={count} value={count}>
                        Top {count} (rest as “Other”)
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {config.kind === "histogram" ? (
                <div>
                  <label className={label} htmlFor="widget-bins">Bins</label>
                  <input id="widget-bins" type="number" min={3} max={50} className={field} value={config.options.bins ?? 10} onChange={(event) => setOption({ bins: Number(event.target.value) || 10 })} />
                </div>
              ) : null}
              {config.kind === "gauge" || config.kind === "bar" || config.kind === "column" || config.kind === "line" ? (
                <div>
                  <label className={label} htmlFor="widget-goal">{config.kind === "gauge" ? "Goal" : "Goal line (optional)"}</label>
                  <input id="widget-goal" type="number" className={field} value={config.options.goal ?? ""} onChange={(event) => setOption({ goal: event.target.value === "" ? undefined : Number(event.target.value) })} />
                </div>
              ) : null}
              {config.kind === "workload" ? (
                <div>
                  <label className={label} htmlFor="widget-capacity">Capacity per person per period</label>
                  <input id="widget-capacity" type="number" min={1} className={field} value={config.options.capacity ?? ""} onChange={(event) => setOption({ capacity: event.target.value === "" ? undefined : Number(event.target.value) })} />
                </div>
              ) : null}
              {config.kind === "kpi" ? (
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-primary" checked={config.options.compare ?? false} onChange={(event) => setOption({ compare: event.target.checked })} />
                  Compare with the previous period
                </label>
              ) : null}
              {dimCount > 0 ? (
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-primary" checked={config.options.labels ?? true} onChange={(event) => setOption({ labels: event.target.checked })} />
                  Show values on the chart
                </label>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={label}>Dashboard date filter uses</label>
                  <ColumnSelect ariaLabel="Date column for dashboard filter" placeholder="Automatic" value={config.options.dateRef} columns={dateColumns} onChange={(dateRef) => setOption({ dateRef })} />
                </div>
                <div>
                  <label className={label}>People filter uses</label>
                  <ColumnSelect ariaLabel="Person column for dashboard filter" placeholder="Automatic" value={config.options.personRef} columns={personColumns} onChange={(personRef) => setOption({ personRef })} />
                </div>
              </div>
            </section>
          </div>

          <div className="flex min-h-[320px] min-w-0 flex-1 flex-col bg-bg p-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Preview</h3>
              <span className="text-xs text-muted" aria-live="polite">
                {previewing ? "Updating…" : preview?.data.type === "agg" ? `${preview.data.result.rowCount.toLocaleString("en-US")} items` : ""}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-surface p-4">
              {preview && preview.kind === config.kind ? (
                <div className={previewing ? "opacity-60" : ""}>
                  <WidgetRenderer config={config} data={preview.data} height={Math.max(220, spec.height === 1 ? 180 : 380)} />
                </div>
              ) : (
                <div className="h-64 animate-pulse rounded-md bg-row" />
              )}
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {error ? (
            <p role="alert" className="me-auto text-sm text-danger">
              {error}
            </p>
          ) : null}
          <button type="button" className="cursor-pointer rounded-md px-3 py-1.5 text-sm hover:bg-row" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || config.source.workbookIds.length === 0}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void save()}
          >
            {widget ? null : <Plus className="size-4" aria-hidden="true" />}
            {saving ? "Saving…" : widget ? "Save widget" : "Add widget"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
