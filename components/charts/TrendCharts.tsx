"use client";

import { useMemo, useState } from "react";
import {
  cellMap,
  colorFor,
  compact,
  EmptyChart,
  fmt,
  Legend,
  niceMax,
  niceTicks,
  SERIES_ONE,
  useWidth,
  valueOf,
  type ChartProps,
} from "./primitives";

const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 10;
const PAD_BOTTOM = 26;
const MAX_SERIES = 8;

interface Line {
  key: string;
  label: string;
  color: string;
  values: number[];
}

/** One or more lines over date buckets, with a hover crosshair. */
function Lines({
  result,
  measure,
  goal,
  onDrill,
  height,
  multi,
  area,
  cumulative,
}: ChartProps & { multi: boolean; area?: boolean; cumulative?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const map = useMemo(() => cellMap(result), [result]);
  const buckets = result.buckets.filter((bucket) => bucket.key !== "");

  const lines: Line[] = useMemo(() => {
    const base = multi
      ? result.series.slice(0, MAX_SERIES).map((item, index) => ({
          key: item.key,
          label: item.label,
          color: colorFor(item, index),
          values: buckets.map((bucket) => valueOf(map, bucket.key, item.key)),
        }))
      : [{ key: "", label: "", color: SERIES_ONE, values: buckets.map((bucket) => valueOf(map, bucket.key)) }];
    if (!cumulative) {
      return base;
    }
    return base.map((line) => {
      let running = 0;
      return { ...line, values: line.values.map((value) => (running += value)) };
    });
  }, [buckets, map, multi, cumulative, result.series]);

  if (buckets.length === 0 || lines.every((line) => line.values.every((value) => value === 0))) {
    return <EmptyChart />;
  }

  const legendSpace = multi && lines.length > 1 ? 28 : 0;
  const plotHeight = height - PAD_TOP - PAD_BOTTOM - legendSpace;
  const plotWidth = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const max = niceMax(Math.max(...lines.flatMap((line) => line.values), goal ?? 0));
  const ticks = niceTicks(max);
  const x = (index: number) => PAD_LEFT + (buckets.length === 1 ? plotWidth / 2 : (index / (buckets.length - 1)) * plotWidth);
  const y = (value: number) => PAD_TOP + plotHeight - (value / max) * plotHeight;
  const labelEvery = Math.max(1, Math.ceil((buckets.length * 70) / Math.max(plotWidth, 1)));

  function pick(clientX: number, rect: DOMRect) {
    if (buckets.length === 0 || plotWidth <= 0) {
      return;
    }
    const relative = clientX - rect.left - PAD_LEFT;
    const index = Math.round((relative / plotWidth) * (buckets.length - 1));
    setHover(Math.max(0, Math.min(buckets.length - 1, index)));
  }

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 ? (
        <svg
          width={width}
          height={height - legendSpace}
          role="img"
          aria-label="Line chart"
          onMouseMove={(event) => pick(event.clientX, event.currentTarget.getBoundingClientRect())}
          onMouseLeave={() => setHover(null)}
          onClick={() => {
            if (hover !== null && buckets[hover]) {
              onDrill?.(buckets[hover]!.key);
            }
          }}
          className={onDrill ? "cursor-pointer" : undefined}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD_LEFT} x2={width - PAD_RIGHT} y1={y(tick)} y2={y(tick)} stroke="var(--chart-grid)" />
              <text x={PAD_LEFT - 6} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)">
                {compact(tick)}
              </text>
            </g>
          ))}
          {goal ? (
            <line x1={PAD_LEFT} x2={width - PAD_RIGHT} y1={y(goal)} y2={y(goal)} stroke="var(--text)" strokeDasharray="4 4" />
          ) : null}
          {lines.map((line) => {
            const path = line.values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(value)}`).join(" ");
            return (
              <g key={line.key}>
                {area ? (
                  <path
                    d={`${path} L${x(line.values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
                    fill={line.color}
                    opacity={0.1}
                  />
                ) : null}
                <path d={path} fill="none" stroke={line.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {/* End marker with a surface ring. */}
                <circle
                  cx={x(line.values.length - 1)}
                  cy={y(line.values[line.values.length - 1] ?? 0)}
                  r={4}
                  fill={line.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              </g>
            );
          })}
          {hover !== null ? (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD_TOP} y2={PAD_TOP + plotHeight} stroke="var(--muted)" strokeWidth={1} />
              {lines.map((line) => (
                <circle
                  key={line.key}
                  cx={x(hover)}
                  cy={y(line.values[hover] ?? 0)}
                  r={4}
                  fill={line.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ))}
            </g>
          ) : null}
          {buckets.map((bucket, index) =>
            index % labelEvery === 0 ? (
              <text key={bucket.key} x={x(index)} y={height - legendSpace - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                {bucket.label.replace("Wk of ", "")}
              </text>
            ) : null,
          )}
        </svg>
      ) : (
        <div style={{ height: height - legendSpace }} />
      )}
      {hover !== null && buckets[hover] ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-0 z-20 w-max max-w-60 -translate-x-1/2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(x(hover), 70), width - 70) }}
        >
          <p className="font-medium text-text">{buckets[hover]!.label}</p>
          {lines.map((line) => (
            <p key={line.key} className="flex items-center gap-1.5 text-muted">
              {multi ? <span aria-hidden="true" className="size-2 rounded-sm" style={{ backgroundColor: line.color }} /> : null}
              <span dir="auto">{multi ? `${line.label}: ` : ""}</span>
              <span className="tabular-nums text-text">{fmt(line.values[hover] ?? 0, measure)}</span>
            </p>
          ))}
        </div>
      ) : null}
      {multi ? <Legend items={lines.map((line) => ({ key: line.key, label: line.label, color: line.color }))} /> : null}
    </div>
  );
}

export function LineChart(props: ChartProps) {
  return <Lines {...props} multi={false} />;
}

export function MultiLineChart(props: ChartProps) {
  return <Lines {...props} multi />;
}

export function AreaChart(props: ChartProps) {
  return <Lines {...props} multi={false} area />;
}

export function CumulativeChart(props: ChartProps) {
  return <Lines {...props} multi={false} area cumulative />;
}
