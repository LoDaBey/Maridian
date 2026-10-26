"use client";

import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import {
  cellMap,
  compact,
  EmptyChart,
  fmt,
  niceMax,
  niceTicks,
  rampColor,
  SERIES_ONE,
  Tip,
  useWidth,
  valueOf,
  type ChartProps,
  type TipState,
} from "./primitives";

const DAY_MS = 86_400_000;

function parseDay(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

/** One square per day, columns are weeks (Mon–Sun), darker = more. */
export function CalendarHeatmap({ result, measure, onDrill, height }: ChartProps) {
  const [tip, setTip] = useState<TipState | null>(null);
  const map = useMemo(() => cellMap(result), [result]);
  const days = result.buckets.map((bucket) => ({ bucket, date: parseDay(bucket.key) })).filter((item) => item.date);
  if (days.length === 0) {
    return <EmptyChart />;
  }
  const first = days[0]!.date!;
  const last = days[days.length - 1]!.date!;
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - ((first.getDay() + 6) % 7));
  const weeks = Math.ceil((last.getTime() - start.getTime()) / DAY_MS / 7) + 1;
  const max = Math.max(...result.buckets.map((bucket) => valueOf(map, bucket.key)), 1);
  const cell = Math.max(8, Math.min(16, Math.floor((height - 30) / 7)));
  const gap = 2;
  const byKey = new Map(days.map((item) => [item.bucket.key, item.bucket]));
  const cells: Array<{ key: string; label: string; value: number; week: number; weekday: number }> = [];
  for (let week = 0; week < weeks; week += 1) {
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + weekday);
      if (date < first || date > last) {
        continue;
      }
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      cells.push({
        key,
        label: byKey.get(key)?.label ?? date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        value: valueOf(map, key),
        week,
        weekday,
      });
    }
  }
  const months: Array<{ week: number; label: string }> = [];
  for (let week = 0; week < weeks; week += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7);
    const label = date.toLocaleDateString("en-US", { month: "short" });
    if (months[months.length - 1]?.label !== label) {
      months.push({ week, label });
    }
  }
  const width = weeks * (cell + gap) + 28;
  return (
    <div className="relative overflow-x-auto" onMouseLeave={() => setTip(null)}>
      <svg width={width} height={7 * (cell + gap) + 22} role="img" aria-label="Calendar heatmap">
        {months.map((month) => (
          <text key={`${month.week}-${month.label}`} x={28 + month.week * (cell + gap)} y={10} fontSize={11} fill="var(--muted)">
            {month.label}
          </text>
        ))}
        {["Mon", "Wed", "Fri"].map((label, index) => (
          <text key={label} x={0} y={16 + (index * 2) * (cell + gap) + cell - 2} fontSize={10} fill="var(--muted)">
            {label}
          </text>
        ))}
        {cells.map((item) => (
          <rect
            key={item.key}
            x={28 + item.week * (cell + gap)}
            y={16 + item.weekday * (cell + gap)}
            width={cell}
            height={cell}
            rx={2}
            fill={rampColor(item.value / max)}
            className={onDrill ? "cursor-pointer" : undefined}
            onMouseEnter={() =>
              setTip({
                x: 28 + item.week * (cell + gap) + cell / 2,
                y: 16 + item.weekday * (cell + gap),
                title: item.label,
                lines: [fmt(item.value, measure)],
              })
            }
            onClick={() => onDrill?.(item.key)}
          />
        ))}
      </svg>
      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted">
        Less
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <span key={t} aria-hidden="true" className="size-2.5 rounded-sm" style={{ backgroundColor: rampColor(t) }} />
        ))}
        More · max {compact(max)}
      </div>
      <Tip tip={tip} />
    </div>
  );
}

/** Two fields crossed; each cell's shade shows its value, numbers shown when they fit. */
export function MatrixHeatmap({ result, measure, onDrill, height, capacity }: ChartProps & { capacity?: number }) {
  const [tip, setTip] = useState<TipState | null>(null);
  const map = useMemo(() => cellMap(result), [result]);
  const rows = result.buckets;
  const cols = result.series;
  if (rows.length === 0 || cols.length === 0) {
    return <EmptyChart />;
  }
  const max = Math.max(...result.cells.map((cell) => cell.value), 1);
  return (
    <div className="relative overflow-auto" style={{ maxHeight: height }} onMouseLeave={() => setTip(null)}>
      <table className="border-separate text-[11px]" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th />
            {cols.map((col) => (
              <th key={col.key} dir="auto" className="max-w-20 truncate px-1 text-center font-normal text-muted" title={col.label}>
                {col.label.replace("Wk of ", "")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th dir="auto" className="max-w-36 truncate pe-2 text-end font-normal text-muted" title={row.label}>
                {row.label}
              </th>
              {cols.map((col) => {
                const value = valueOf(map, row.key, col.key);
                const over = capacity !== undefined && value > capacity;
                const strong = value / max > 0.55;
                return (
                  <td key={col.key} className="p-0">
                    <button
                      type="button"
                      aria-label={`${row.label}, ${col.label}: ${fmt(value, measure)}${over ? " (over capacity)" : ""}`}
                      className={`flex h-7 min-w-10 w-full items-center justify-center gap-0.5 rounded-[3px] tabular-nums ${onDrill ? "cursor-pointer" : "cursor-default"}`}
                      style={{
                        backgroundColor: rampColor(value / max),
                        color: strong ? "white" : "var(--text)",
                        boxShadow: over ? "inset 0 0 0 2px var(--danger)" : undefined,
                      }}
                      onMouseEnter={(event) => {
                        const box = event.currentTarget.getBoundingClientRect();
                        const parent = event.currentTarget.closest("div")!.getBoundingClientRect();
                        setTip({
                          x: box.left - parent.left + box.width / 2,
                          y: box.top - parent.top,
                          title: `${row.label} · ${col.label}`,
                          lines: [fmt(value, measure), over ? `Over capacity (${capacity})` : ""].filter(Boolean),
                        });
                      }}
                      onClick={() => onDrill?.(row.key, col.key)}
                    >
                      {over ? <TriangleAlert className="size-3" aria-hidden="true" /> : null}
                      {value > 0 ? compact(value) : ""}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <Tip tip={tip} />
    </div>
  );
}

/** Items per person (rows) per week (columns), outlined in red above the weekly capacity. */
export function WorkloadChart(props: ChartProps & { capacity?: number }) {
  return (
    <div>
      <MatrixHeatmap {...props} />
      {props.capacity ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted">
          <TriangleAlert className="size-3 text-danger" aria-hidden="true" />
          Outlined cells are over the weekly capacity of {props.capacity}.
        </p>
      ) : null}
    </div>
  );
}

export function ScatterChart({
  points,
  xLabel,
  yLabel,
  height,
}: {
  points: Array<{ x: number; y: number }>;
  xLabel: string;
  yLabel: string;
  height: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  if (points.length === 0) {
    return <EmptyChart message="No items have both numbers yet." />;
  }
  const pad = { left: 44, right: 12, top: 10, bottom: 30 };
  const maxX = niceMax(Math.max(...points.map((point) => point.x)));
  const maxY = niceMax(Math.max(...points.map((point) => point.y)));
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const x = (value: number) => pad.left + (value / maxX) * plotW;
  const y = (value: number) => pad.top + plotH - (value / maxY) * plotH;
  return (
    <div ref={ref} className="relative w-full" onMouseLeave={() => setTip(null)}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={`Scatter of ${xLabel} and ${yLabel}`}>
          {niceTicks(maxY).map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="var(--chart-grid)" />
              <text x={pad.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)">
                {compact(tick)}
              </text>
            </g>
          ))}
          {niceTicks(maxX).map((tick) => (
            <text key={tick} x={x(tick)} y={height - 14} textAnchor="middle" fontSize={11} fill="var(--muted)">
              {compact(tick)}
            </text>
          ))}
          <text x={width - pad.right} y={height - 1} textAnchor="end" fontSize={11} fill="var(--muted)">
            {xLabel} →
          </text>
          {points.map((point, index) => (
            <circle
              key={index}
              cx={x(point.x)}
              cy={y(point.y)}
              r={4}
              fill={SERIES_ONE}
              fillOpacity={0.6}
              stroke="var(--surface)"
              strokeWidth={1}
              onMouseEnter={() => setTip({ x: x(point.x), y: y(point.y), title: `${xLabel}: ${compact(point.x)}`, lines: [`${yLabel}: ${compact(point.y)}`] })}
            />
          ))}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      <Tip tip={tip} />
    </div>
  );
}
