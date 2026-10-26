"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatValue, type AnalyticsResult, type Bucket, type Measure } from "@/lib/analytics/types";

/** Single-series mark colour. */
export const SERIES_ONE = "var(--chart-1)";

/** Categorical colours in fixed order. Past 8, callers fold series into "Other". */
export function seriesColor(index: number): string {
  return `var(--series-${(index % 8) + 1})`;
}

/** A series keeps its data colour (status labels) or takes the next categorical slot. */
export function colorFor(bucket: Bucket, index: number): string {
  return bucket.color ?? seriesColor(index);
}

/** Sequential ramp of the single series hue: t = 0 (lightest) … 1 (darkest). */
export function rampColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped === 0) {
    return "var(--chart-grid)";
  }
  return `color-mix(in srgb, var(--chart-1) ${Math.round(18 + clamped * 82)}%, var(--surface))`;
}

/** Clean axis maximum: 1, 2, 2.5, 5 × 10^n. */
export function niceMax(value: number): number {
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

export function niceTicks(max: number, count = 4): number[] {
  const top = niceMax(max);
  return Array.from({ length: count + 1 }, (_, index) => (top / count) * index);
}

export function compact(value: number): string {
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function pct(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : "0%";
}

/** Value lookup for a (bucket, series) pair. */
export function cellMap(result: AnalyticsResult): Map<string, number> {
  const map = new Map<string, number>();
  for (const cell of result.cells) {
    map.set(`${cell.k1}\u0000${cell.k2}`, (map.get(`${cell.k1}\u0000${cell.k2}`) ?? 0) + cell.value);
  }
  return map;
}

export function valueOf(map: Map<string, number>, k1: string, k2 = ""): number {
  return map.get(`${k1}\u0000${k2}`) ?? 0;
}

/** First-dimension totals in bucket order. */
export function bucketTotals(result: AnalyticsResult): Array<Bucket & { value: number }> {
  const totals = new Map<string, number>();
  for (const cell of result.cells) {
    totals.set(cell.k1, (totals.get(cell.k1) ?? 0) + cell.value);
  }
  return result.buckets.map((bucket) => ({ ...bucket, value: totals.get(bucket.key) ?? 0 }));
}

/** Watches an element's width so SVG charts can lay out in real pixels. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      setWidth((current) => (current === next ? current : next));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export interface TipState {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

/** A tooltip positioned inside a relative container. Text uses text tokens, never the data colour. */
export function Tip({ tip }: { tip: TipState | null }) {
  if (!tip) {
    return null;
  }
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 w-max max-w-60 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text shadow-lg"
      style={{ left: tip.x, top: tip.y - 8 }}
    >
      <p dir="auto" className="font-medium">
        {tip.title}
      </p>
      {tip.lines.map((line) => (
        <p key={line} dir="auto" className="text-muted">
          {line}
        </p>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: Array<{ key: string; label: string; color: string; value?: string }> }) {
  if (items.length < 2) {
    return null;
  }
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {items.map((item) => (
        <li key={item.key} className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: item.color }} />
          <span dir="auto" className="max-w-40 truncate text-text">
            {item.label}
          </span>
          {item.value ? <span className="tabular-nums text-muted">{item.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function EmptyChart({ message = "No data for these settings yet." }: { message?: string }) {
  return <p className="flex h-full min-h-24 items-center justify-center px-4 text-center text-sm text-muted">{message}</p>;
}

export interface ChartProps {
  result: AnalyticsResult;
  measure: Measure;
  /** Show values on marks. */
  labels?: boolean;
  goal?: number;
  /** Click a mark to see its items. */
  onDrill?: (k1: string, k2?: string) => void;
  height: number;
}

export function fmt(value: number, measure: Measure): string {
  return formatValue(value, measure);
}

export function Frame({ children, height }: { children: ReactNode; height: number }) {
  return (
    <div className="relative w-full" style={{ height }}>
      {children}
    </div>
  );
}
