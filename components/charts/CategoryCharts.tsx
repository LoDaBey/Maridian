"use client";

import { useMemo, useState } from "react";
import type { AnalyticsResult } from "@/lib/analytics/types";
import {
  bucketTotals,
  cellMap,
  colorFor,
  compact,
  EmptyChart,
  fmt,
  Legend,
  niceMax,
  niceTicks,
  pct,
  SERIES_ONE,
  seriesColor,
  Tip,
  useWidth,
  valueOf,
  type ChartProps,
  type TipState,
} from "./primitives";

const PAD_LEFT = 44;
const PAD_BOTTOM = 26;
const PAD_TOP = 10;

/** Horizontal bars: long category labels (Arabic included) read well. */
export function BarChart({ result, measure, labels = true, goal, onDrill, height }: ChartProps) {
  const rows = bucketTotals(result);
  const [tip, setTip] = useState<TipState | null>(null);
  if (rows.every((row) => row.value === 0)) {
    return <EmptyChart />;
  }
  const max = niceMax(Math.max(...rows.map((row) => row.value), goal ?? 0));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const rowHeight = Math.max(18, Math.min(28, Math.floor((height - 8) / Math.max(1, rows.length))));
  return (
    <div className="relative overflow-y-auto" style={{ maxHeight: height }} onMouseLeave={() => setTip(null)}>
      <ul className="space-y-1" aria-label="Bar chart">
        {rows.map((row) => {
          const width = (row.value / max) * 100;
          return (
            <li
              key={row.key}
              className="grid grid-cols-[minmax(5rem,10rem)_1fr] items-center gap-2 text-[12px]"
              style={{ height: rowHeight }}
            >
              <span dir="auto" className="truncate text-muted" title={row.label}>
                {row.label}
              </span>
              <span className="relative flex h-full min-w-0 items-center gap-1.5">
                <span className="flex h-full min-w-0 flex-1 items-center">
                <button
                  type="button"
                  aria-label={`${row.label}: ${fmt(row.value, measure)}`}
                  className={`h-[70%] min-w-[2px] rounded-e-[4px] outline-none focus-visible:ring-2 focus-visible:ring-primary ${onDrill ? "cursor-pointer" : "cursor-default"}`}
                  style={{ width: `${width}%`, backgroundColor: row.color ?? SERIES_ONE }}
                  onMouseEnter={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    const parent = event.currentTarget.closest("ul")!.getBoundingClientRect();
                    setTip({
                      x: box.right - parent.left,
                      y: box.top - parent.top,
                      title: row.label,
                      lines: [fmt(row.value, measure), measure.op === "count" ? `${pct(row.value, total)} of items` : ""].filter(Boolean),
                    });
                  }}
                  onClick={() => onDrill?.(row.key)}
                />
                </span>
                {labels ? <span className="w-12 shrink-0 tabular-nums text-text">{fmt(row.value, measure)}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      {goal ? <p className="mt-1 text-xs text-muted">Goal: {fmt(goal, measure)}</p> : null}
      <Tip tip={tip} />
    </div>
  );
}

interface ColumnSeries {
  key: string;
  label: string;
  color: string;
}

/** Vertical columns; with series they stack (or show shares when `percent`). */
function Columns({
  result,
  measure,
  labels,
  goal,
  onDrill,
  height,
  stacked,
  percent,
}: ChartProps & { stacked: boolean; percent?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const map = useMemo(() => cellMap(result), [result]);
  const series: ColumnSeries[] = stacked
    ? result.series.map((item, index) => ({ key: item.key, label: item.label, color: colorFor(item, index) }))
    : [{ key: "", label: "", color: SERIES_ONE }];
  const totals = result.buckets.map((bucket) => series.reduce((sum, item) => sum + valueOf(map, bucket.key, item.key), 0));
  if (totals.every((total) => total === 0)) {
    return <EmptyChart />;
  }
  const max = percent ? 100 : niceMax(Math.max(...totals, goal ?? 0));
  const ticks = percent ? [0, 25, 50, 75, 100] : niceTicks(max);
  const legendSpace = stacked && series.length > 1 ? 28 : 0;
  const plotHeight = height - PAD_BOTTOM - PAD_TOP - legendSpace;
  const plotWidth = Math.max(0, width - PAD_LEFT);
  const band = result.buckets.length > 0 ? plotWidth / result.buckets.length : 0;
  const barWidth = Math.max(2, Math.min(24, band * 0.7));
  const y = (value: number) => PAD_TOP + plotHeight - (value / max) * plotHeight;
  const labelEvery = Math.max(1, Math.ceil((result.buckets.length * 64) / Math.max(plotWidth, 1)));

  return (
    <div ref={ref} className="relative w-full" onMouseLeave={() => setTip(null)}>
      {width > 0 ? (
        <svg width={width} height={height - legendSpace} role="img" aria-label="Column chart">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD_LEFT} x2={width} y1={y(tick)} y2={y(tick)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={PAD_LEFT - 6} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)">
                {percent ? `${tick}%` : compact(tick)}
              </text>
            </g>
          ))}
          {goal && !percent ? (
            <line x1={PAD_LEFT} x2={width} y1={y(goal)} y2={y(goal)} stroke="var(--text)" strokeDasharray="4 4" strokeWidth={1} />
          ) : null}
          {result.buckets.map((bucket, index) => {
            const x = PAD_LEFT + index * band + (band - barWidth) / 2;
            let base = 0;
            const total = totals[index] ?? 0;
            return (
              <g key={bucket.key}>
                {series.map((item, seriesIndex) => {
                  const raw = valueOf(map, bucket.key, item.key);
                  const value = percent ? (total > 0 ? (raw / total) * 100 : 0) : raw;
                  if (value <= 0) {
                    return null;
                  }
                  const top = y(base + value);
                  const bottom = y(base);
                  base += value;
                  const isTop = seriesIndex === series.length - 1 || series.slice(seriesIndex + 1).every((next) => valueOf(map, bucket.key, next.key) <= 0);
                  // 2px surface gap between stacked segments.
                  const h = Math.max(1, bottom - top - (stacked ? 2 : 0));
                  const color = stacked ? item.color : (bucket.color ?? SERIES_ONE);
                  return (
                    <rect
                      key={item.key}
                      x={x}
                      y={top}
                      width={barWidth}
                      height={h}
                      rx={isTop ? 4 : 0}
                      fill={color}
                      className={onDrill ? "cursor-pointer" : undefined}
                      onMouseEnter={() =>
                        setTip({
                          x: x + barWidth / 2,
                          y: top,
                          title: stacked ? `${bucket.label} · ${item.label}` : bucket.label,
                          lines: [percent ? `${Math.round(value)}% (${fmt(raw, measure)})` : fmt(raw, measure)],
                        })
                      }
                      onClick={() => onDrill?.(bucket.key, stacked ? item.key : undefined)}
                    />
                  );
                })}
                {labels && !percent && total > 0 && barWidth >= 14 ? (
                  <text x={x + barWidth / 2} y={y(total) - 4} textAnchor="middle" fontSize={10} fill="var(--text)">
                    {compact(total)}
                  </text>
                ) : null}
                {index % labelEvery === 0 ? (
                  <text x={x + barWidth / 2} y={height - legendSpace - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                    {bucket.label.length > 14 ? `${bucket.label.slice(0, 13)}…` : bucket.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ height: height - legendSpace }} />
      )}
      {stacked ? <Legend items={series} /> : null}
      <Tip tip={tip} />
    </div>
  );
}

export function ColumnChart(props: ChartProps) {
  return <Columns {...props} stacked={false} />;
}

export function StackedColumnChart(props: ChartProps) {
  return <Columns {...props} stacked />;
}

export function Stacked100Chart(props: ChartProps) {
  return <Columns {...props} stacked percent />;
}

/** Stages in status order, each bar's width relative to the first stage. */
export function FunnelChart({ result, measure, onDrill, height }: ChartProps) {
  const rows = bucketTotals(result).filter((row) => row.key !== "");
  if (rows.length === 0 || rows.every((row) => row.value === 0)) {
    return <EmptyChart />;
  }
  const max = Math.max(...rows.map((row) => row.value));
  const first = rows[0]?.value ?? 0;
  return (
    <ul className="flex flex-col justify-center gap-1.5 overflow-y-auto" style={{ maxHeight: height }}>
      {rows.map((row) => (
        <li key={row.key} className="flex items-center gap-2 text-[12px]">
          <span dir="auto" className="w-28 shrink-0 truncate text-end text-muted">
            {row.label}
          </span>
          <span className="flex min-w-0 flex-1 justify-center">
            <button
              type="button"
              aria-label={`${row.label}: ${fmt(row.value, measure)}`}
              className={`h-6 min-w-[2px] rounded-[4px] ${onDrill ? "cursor-pointer" : "cursor-default"}`}
              style={{ width: `${(row.value / max) * 100}%`, backgroundColor: row.color ?? SERIES_ONE }}
              onClick={() => onDrill?.(row.key)}
            />
          </span>
          <span className="w-20 shrink-0 tabular-nums text-text">
            {fmt(row.value, measure)} <span className="text-muted">{pct(row.value, first)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <span className="inline-block w-16" />;
  }
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 64},${18 - (value / max) * 16}`).join(" ");
  return (
    <svg width={64} height={20} aria-hidden="true">
      <polyline points={points} fill="none" stroke={SERIES_ONE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Ranked rows with a share bar and a 12-week sparkline. */
export function LeaderboardChart({
  result,
  trend,
  measure,
  onDrill,
  height,
}: ChartProps & { trend?: AnalyticsResult }) {
  const rows = bucketTotals(result)
    .filter((row) => row.key !== "")
    .sort((a, b) => b.value - a.value);
  const trendMap = useMemo(() => (trend ? cellMap(trend) : null), [trend]);
  if (rows.length === 0) {
    return <EmptyChart />;
  }
  const max = rows[0]?.value ?? 1;
  const weeks = trend?.series.slice(-12) ?? [];
  return (
    <ol className="divide-y divide-border overflow-y-auto" style={{ maxHeight: height }}>
      {rows.map((row, index) => (
        <li key={row.key}>
          <button
            type="button"
            className={`flex w-full items-center gap-3 py-1.5 text-start text-[13px] ${onDrill ? "cursor-pointer hover:bg-row" : "cursor-default"}`}
            onClick={() => onDrill?.(row.key)}
          >
            <span className="w-5 shrink-0 text-end tabular-nums text-muted">{index + 1}</span>
            <span className="min-w-0 flex-1">
              <span dir="auto" className="block truncate text-text">
                {row.label}
              </span>
              <span className="mt-0.5 block h-1.5 rounded-full bg-track">
                <span className="block h-full rounded-full" style={{ width: `${(row.value / max) * 100}%`, backgroundColor: SERIES_ONE }} />
              </span>
            </span>
            {trendMap ? <Sparkline values={weeks.map((week) => valueOf(trendMap, row.key, week.key))} /> : null}
            <span className="w-14 shrink-0 text-end tabular-nums text-text">{fmt(row.value, measure)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Distribution of a number column: distinct values grouped into equal bins. */
export function HistogramChart({ result, measure, height, bins = 10 }: ChartProps & { bins?: number }) {
  const values = bucketTotals(result)
    .filter((row) => row.key !== "" && Number.isFinite(Number(row.key)))
    .map((row) => ({ x: Number(row.key), count: row.value }));
  if (values.length === 0) {
    return <EmptyChart message="Choose a number column with values." />;
  }
  const min = Math.min(...values.map((item) => item.x));
  const max = Math.max(...values.map((item) => item.x));
  const count = Math.max(1, Math.min(bins, values.length));
  const step = (max - min) / count || 1;
  const binsList = Array.from({ length: count }, (_, index) => ({ from: min + index * step, to: min + (index + 1) * step, value: 0 }));
  for (const item of values) {
    const index = Math.min(count - 1, Math.floor((item.x - min) / step));
    binsList[index]!.value += item.count;
  }
  const histogram: AnalyticsResult = {
    buckets: binsList.map((bin) => ({ key: String(bin.from), label: `${compact(bin.from)}–${compact(bin.to)}` })),
    series: [],
    cells: binsList.map((bin) => ({ k1: String(bin.from), k2: "", value: bin.value, rows: bin.value })),
    total: result.total,
    rowCount: result.rowCount,
  };
  return <Columns result={histogram} measure={{ op: "count" }} labels={false} height={height} stacked={false} />;
}

/** Change from one period to the next, as floating bars (up = series colour, down = muted). */
export function WaterfallChart({ result, measure, height }: ChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const rows = bucketTotals(result).filter((row) => row.key !== "");
  if (rows.length < 2) {
    return <EmptyChart message="Needs at least two periods." />;
  }
  const deltas = rows.slice(1).map((row, index) => ({ ...row, delta: row.value - rows[index]!.value }));
  const extent = niceMax(Math.max(...deltas.map((item) => Math.abs(item.delta)), 1));
  const plotHeight = height - PAD_BOTTOM - PAD_TOP;
  const plotWidth = Math.max(0, width - PAD_LEFT);
  const band = plotWidth / deltas.length;
  const barWidth = Math.max(2, Math.min(24, band * 0.7));
  const zero = PAD_TOP + plotHeight / 2;
  const scale = plotHeight / 2 / extent;
  return (
    <div ref={ref} className="relative w-full" onMouseLeave={() => setTip(null)}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label="Period change chart">
          {[extent, 0, -extent].map((tick) => (
            <g key={tick}>
              <line x1={PAD_LEFT} x2={width} y1={zero - tick * scale} y2={zero - tick * scale} stroke="var(--chart-grid)" />
              <text x={PAD_LEFT - 6} y={zero - tick * scale} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)">
                {tick > 0 ? `+${compact(tick)}` : compact(tick)}
              </text>
            </g>
          ))}
          {deltas.map((item, index) => {
            const x = PAD_LEFT + index * band + (band - barWidth) / 2;
            const h = Math.max(1, Math.abs(item.delta) * scale);
            const up = item.delta >= 0;
            return (
              <g key={item.key}>
                <rect
                  x={x}
                  y={up ? zero - h : zero}
                  width={barWidth}
                  height={h}
                  rx={2}
                  fill={up ? SERIES_ONE : "var(--muted)"}
                  onMouseEnter={() =>
                    setTip({
                      x: x + barWidth / 2,
                      y: up ? zero - h : zero,
                      title: item.label,
                      lines: [`${up ? "+" : ""}${fmt(item.delta, measure)} vs previous`, `Total ${fmt(item.value, measure)}`],
                    })
                  }
                />
                <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                  {item.label.length > 10 ? `${item.label.slice(0, 9)}…` : item.label}
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      <Tip tip={tip} />
    </div>
  );
}

export { seriesColor };
