"use client";

import { useState, type ReactNode } from "react";
import type { Bucket, ChartKind, ChartResult, Metric } from "@/lib/charts/aggregate";
import { formatMetric, metricLabel } from "@/lib/charts/aggregate";

const SERIES = "var(--chart-1)";

function share(value: number, total: number): string {
  if (total <= 0) {
    return "0%";
  }
  return `${Math.round((value / total) * 100)}%`;
}

/** Rounds the axis maximum up to a clean number (1, 2, 2.5, 5 × 10^n). */
function niceMax(value: number): number {
  if (value <= 0) {
    return 1;
  }
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * power >= value) {
      return step * power;
    }
  }
  return 10 * power;
}

function Tooltip({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-56 -translate-x-1/2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text shadow-lg"
    >
      <p dir="auto" className="font-medium">
        {title}
      </p>
      {lines.map((line) => (
        <p key={line} className="text-muted">
          {line}
        </p>
      ))}
    </div>
  );
}

/** Horizontal bars: category labels read well (including long Arabic labels). */
export function BarChart({ result, metric }: { result: ChartResult; metric: Metric }) {
  const [active, setActive] = useState<string | null>(null);
  const max = niceMax(Math.max(0, ...result.buckets.map((bucket) => bucket.value)));
  const sumAll = result.buckets.reduce((sum, bucket) => sum + bucket.value, 0);

  return (
    <ul className="space-y-1.5" aria-label={metricLabel(metric)}>
      {result.buckets.map((bucket) => {
        const width = max > 0 ? (bucket.value / max) * 100 : 0;
        const open = active === bucket.key;
        return (
          <li key={bucket.key} className="grid grid-cols-[minmax(6rem,11rem)_1fr] items-center gap-3 text-[13px]">
            <span dir="auto" className="truncate text-muted" title={bucket.label}>
              {bucket.label}
            </span>
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                aria-label={`${bucket.label}: ${formatMetric(bucket.value, metric)}`}
                className="relative h-6 min-w-1 cursor-default rounded-e-[4px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
                style={{ width: `${Math.max(width, bucket.value > 0 ? 0.8 : 0)}%`, backgroundColor: bucket.color ?? SERIES, maxWidth: "calc(100% - 3.5rem)" }}
                onMouseEnter={() => setActive(bucket.key)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(bucket.key)}
                onBlur={() => setActive(null)}
              >
                {open ? (
                  <Tooltip
                    title={bucket.label}
                    lines={[
                      `${metricLabel(metric)}: ${formatMetric(bucket.value, metric)}`,
                      metric.op === "count" ? `${share(bucket.value, sumAll)} of items` : `${bucket.rows} items`,
                    ]}
                  />
                ) : null}
              </button>
              <span className="shrink-0 tabular-nums text-text">{formatMetric(bucket.value, metric)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Monday-style "battery": one 100% bar split by label, with a legend that carries the numbers. */
export function BatteryChart({ result, metric }: { result: ChartResult; metric: Metric }) {
  const [active, setActive] = useState<string | null>(null);
  const items = result.buckets.filter((bucket) => bucket.value > 0);
  const sumAll = items.reduce((sum, bucket) => sum + bucket.value, 0);
  // Without data-defined colors, segments step through a fixed lightness ramp of the series hue.
  const fallback = (index: number) => `color-mix(in srgb, ${SERIES} ${Math.max(35, 100 - index * 15)}%, var(--surface))`;

  return (
    <div>
      <div className="flex h-7 w-full gap-[2px] overflow-visible rounded-[4px]">
        {items.map((bucket, index) => (
          <button
            key={bucket.key}
            type="button"
            aria-label={`${bucket.label}: ${formatMetric(bucket.value, metric)} (${share(bucket.value, sumAll)})`}
            className="relative h-full min-w-1 cursor-default outline-none first:rounded-s-[4px] last:rounded-e-[4px] focus-visible:ring-2 focus-visible:ring-primary"
            style={{ flexGrow: bucket.value, flexBasis: 0, backgroundColor: bucket.color ?? fallback(index) }}
            onMouseEnter={() => setActive(bucket.key)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(bucket.key)}
            onBlur={() => setActive(null)}
          >
            {active === bucket.key ? (
              <Tooltip title={bucket.label} lines={[`${formatMetric(bucket.value, metric)} · ${share(bucket.value, sumAll)}`]} />
            ) : null}
          </button>
        ))}
        {items.length === 0 ? <div className="h-full w-full rounded-[4px] bg-track" /> : null}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
        {items.map((bucket, index) => (
          <li key={bucket.key} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: bucket.color ?? fallback(index) }}
            />
            <span dir="auto" className="text-text">
              {bucket.label}
            </span>
            <span className="tabular-nums text-muted">
              {formatMetric(bucket.value, metric)} · {share(bucket.value, sumAll)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Columns over time. One axis, clean ticks, labels thinned so they never collide. */
export function TimeChart({ result, metric }: { result: ChartResult; metric: Metric }) {
  const [active, setActive] = useState<string | null>(null);
  const buckets = result.buckets;
  const max = niceMax(Math.max(0, ...buckets.map((bucket) => bucket.value)));
  const ticks = [max, max / 2, 0];
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));

  if (buckets.length === 0) {
    return <EmptyChart />;
  }

  return (
    <div className="flex gap-2 text-[11px]" dir="ltr">
      <div className="-mt-1.5 flex h-[10.5rem] flex-col justify-between pb-0 text-end tabular-nums text-muted">
        {ticks.map((tick) => (
          <span key={tick}>{formatMetric(tick, metric)}</span>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[9.75rem]">
          {ticks.map((tick, index) => (
            <div
              key={tick}
              className="absolute inset-x-0 border-t border-track"
              style={{ top: `${(index / (ticks.length - 1)) * 100}%` }}
            />
          ))}
        </div>
        <div className="relative mb-5 flex h-[9.75rem] items-end gap-[2px]">
          {buckets.map((bucket, index) => (
            <div key={bucket.key} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end">
              <button
                type="button"
                aria-label={`${bucket.label}: ${formatMetric(bucket.value, metric)}`}
                className="relative w-full max-w-6 cursor-default rounded-t-[4px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
                style={{ height: `${(bucket.value / max) * 100}%`, minHeight: bucket.value > 0 ? 2 : 0, backgroundColor: SERIES }}
                onMouseEnter={() => setActive(bucket.key)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(bucket.key)}
                onBlur={() => setActive(null)}
              >
                {active === bucket.key ? (
                  <Tooltip title={bucket.label} lines={[`${metricLabel(metric)}: ${formatMetric(bucket.value, metric)}`]} />
                ) : null}
              </button>
              <span className="absolute top-full mt-1 h-4 w-max text-muted">
                {index % labelEvery === 0 ? bucket.label.replace("Week of ", "") : ""}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StatTile({ result, metric, caption }: { result: ChartResult; metric: Metric; caption: string }) {
  return (
    <div className="flex h-full flex-col justify-center">
      <p className="text-4xl font-semibold tabular-nums tracking-tight text-text">
        {formatMetric(result.total, metric)}
      </p>
      <p className="mt-1 text-sm text-muted">{caption}</p>
    </div>
  );
}

export function ChartTableView({ result, metric, groupLabel }: { result: ChartResult; metric: Metric; groupLabel: string }) {
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-[13px]">
        <thead className="text-start text-xs text-muted">
          <tr>
            <th className="py-1 text-start font-medium">{groupLabel}</th>
            <th className="py-1 text-end font-medium">{metricLabel(metric)}</th>
            <th className="py-1 text-end font-medium">Items</th>
          </tr>
        </thead>
        <tbody>
          {result.buckets.map((bucket) => (
            <tr key={bucket.key} className="border-t border-border">
              <td dir="auto" className="py-1">
                {bucket.label}
              </td>
              <td className="py-1 text-end tabular-nums">{formatMetric(bucket.value, metric)}</td>
              <td className="py-1 text-end tabular-nums text-muted">{bucket.rows}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyChart({ message = "No data for these settings yet." }: { message?: string }) {
  return <p className="py-8 text-center text-sm text-muted">{message}</p>;
}

/** Renders the right chart for a kind, with a Chart / Table toggle. */
export function ChartBody({
  kind,
  result,
  metric,
  groupLabel,
  caption,
  footer,
}: {
  kind: ChartKind;
  result: ChartResult;
  metric: Metric;
  groupLabel: string;
  caption: string;
  footer?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  if (kind === "number") {
    return <StatTile result={result} metric={metric} caption={caption} />;
  }
  const empty = result.buckets.every((bucket) => bucket.value === 0);
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        {empty ? (
          <EmptyChart />
        ) : asTable ? (
          <ChartTableView result={result} metric={metric} groupLabel={groupLabel} />
        ) : kind === "battery" ? (
          <BatteryChart result={result} metric={metric} />
        ) : kind === "time" ? (
          <TimeChart result={result} metric={metric} />
        ) : (
          <BarChart result={result} metric={metric} />
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted">
        <span>{caption}</span>
        <span className="flex items-center gap-3">
          {footer}
          {!empty ? (
            <button
              type="button"
              className="cursor-pointer text-primary hover:underline"
              onClick={() => setAsTable((value) => !value)}
            >
              {asTable ? "Show chart" : "Show table"}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

export type { Bucket };
