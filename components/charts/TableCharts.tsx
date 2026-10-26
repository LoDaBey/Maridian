"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { Measure } from "@/lib/analytics/types";
import { cellMap, EmptyChart, fmt, pct, rampColor, SERIES_ONE, valueOf, type ChartProps } from "./primitives";

/** One big number, optionally with change vs the previous period. */
export function KpiChart({
  result,
  measure,
  previous,
  caption,
}: {
  result: ChartProps["result"];
  measure: Measure;
  previous?: number;
  caption: string;
}) {
  const value = result.total;
  const change = previous !== undefined && previous > 0 ? ((value - previous) / previous) * 100 : null;
  const Icon = change === null ? Minus : change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  return (
    <div className="flex h-full flex-col justify-center">
      <p className="text-[2.6rem] font-semibold leading-none tracking-tight tabular-nums text-text">{fmt(value, measure)}</p>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-muted">
        {change !== null ? (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium ${
              change >= 0 ? "bg-success/15 text-text" : "bg-danger/15 text-text"
            }`}
          >
            <Icon className={`size-3.5 ${change >= 0 ? "text-success" : "text-danger"}`} aria-hidden="true" />
            {change > 0 ? "+" : ""}
            {change.toFixed(1)}%
          </span>
        ) : null}
        <span>{change !== null ? `vs previous period (${fmt(previous ?? 0, measure)})` : caption}</span>
      </p>
    </div>
  );
}

/** Progress toward a goal as a half ring. */
export function GaugeChart({ result, measure, goal }: { result: ChartProps["result"]; measure: Measure; goal?: number }) {
  if (!goal) {
    return <EmptyChart message="Set a goal in the widget settings." />;
  }
  const value = result.total;
  const ratio = Math.max(0, Math.min(1, value / goal));
  const radius = 64;
  const stroke = 14;
  const length = Math.PI * radius;
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <svg width={radius * 2 + stroke} height={radius + stroke} role="img" aria-label={`${pct(value, goal)} of goal`}>
        <path
          d={`M${stroke / 2},${radius + stroke / 2} A${radius},${radius} 0 0 1 ${radius * 2 + stroke / 2},${radius + stroke / 2}`}
          fill="none"
          stroke="var(--chart-grid)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={`M${stroke / 2},${radius + stroke / 2} A${radius},${radius} 0 0 1 ${radius * 2 + stroke / 2},${radius + stroke / 2}`}
          fill="none"
          stroke={ratio >= 1 ? "var(--success)" : SERIES_ONE}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${length * ratio} ${length}`}
        />
      </svg>
      <p className="-mt-6 text-2xl font-semibold tabular-nums text-text">{pct(value, goal)}</p>
      <p className="text-xs text-muted">
        {fmt(value, measure)} of {fmt(goal, measure)}
      </p>
    </div>
  );
}

/** Rows × columns × measure with row and column totals; shades help scanning. */
export function PivotChart({ result, measure, onDrill, height }: ChartProps) {
  const map = useMemo(() => cellMap(result), [result]);
  if (result.buckets.length === 0) {
    return <EmptyChart />;
  }
  const max = Math.max(...result.cells.map((cell) => cell.value), 1);
  const rowTotal = (key: string) => result.series.reduce((sum, col) => sum + valueOf(map, key, col.key), 0);
  const colTotal = (key: string) => result.buckets.reduce((sum, row) => sum + valueOf(map, row.key, key), 0);
  const grand = result.cells.reduce((sum, cell) => sum + cell.value, 0);
  return (
    <div className="overflow-auto" style={{ maxHeight: height }}>
      <table className="w-full text-[12px] tabular-nums">
        <thead className="sticky top-0 bg-surface">
          <tr className="text-muted">
            <th className="px-2 py-1 text-start font-medium" />
            {result.series.map((col) => (
              <th key={col.key} dir="auto" className="whitespace-nowrap px-2 py-1 text-end font-medium">
                {col.label}
              </th>
            ))}
            <th className="px-2 py-1 text-end font-semibold text-text">Total</th>
          </tr>
        </thead>
        <tbody>
          {result.buckets.map((row) => (
            <tr key={row.key} className="border-t border-border">
              <th dir="auto" className="max-w-44 truncate px-2 py-1 text-start font-normal text-text" title={row.label}>
                {row.label}
              </th>
              {result.series.map((col) => {
                const value = valueOf(map, row.key, col.key);
                return (
                  <td key={col.key} className="p-0">
                    <button
                      type="button"
                      className={`w-full px-2 py-1 text-end ${onDrill && value > 0 ? "cursor-pointer hover:underline" : "cursor-default"}`}
                      style={{ backgroundColor: value > 0 ? `color-mix(in srgb, ${rampColor(value / max)} 45%, transparent)` : undefined }}
                      onClick={() => value > 0 && onDrill?.(row.key, col.key)}
                    >
                      {value > 0 ? fmt(value, measure) : "–"}
                    </button>
                  </td>
                );
              })}
              <td className="px-2 py-1 text-end font-semibold text-text">{fmt(rowTotal(row.key), measure)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border font-semibold text-text">
            <th className="px-2 py-1 text-start">Total</th>
            {result.series.map((col) => (
              <td key={col.key} className="px-2 py-1 text-end">
                {fmt(colTotal(col.key), measure)}
              </td>
            ))}
            <td className="px-2 py-1 text-end">{fmt(grand, measure)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function ItemListChart({
  columns,
  items,
  rowCount,
  height,
}: {
  columns: string[];
  items: Array<{ rowId: string; sheetId: string; tab: string; cells: string[]; updatedAt: string }>;
  rowCount: number;
  height: number;
}) {
  if (items.length === 0) {
    return <EmptyChart message="No items match." />;
  }
  return (
    <div className="overflow-auto" style={{ maxHeight: height }}>
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-surface text-muted">
          <tr>
            {columns.map((column) => (
              <th key={column} dir="auto" className="whitespace-nowrap px-2 py-1 text-start font-medium">
                {column}
              </th>
            ))}
            <th className="px-2 py-1 text-start font-medium">Tab</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.rowId} className="border-t border-border hover:bg-row">
              {item.cells.map((cell, index) => (
                <td key={index} dir="auto" className="max-w-56 truncate px-2 py-1 text-text" title={cell}>
                  {index === 0 ? (
                    <Link href={`/s/${item.sheetId}?item=${item.rowId}`} className="text-primary hover:underline">
                      {cell || "Untitled"}
                    </Link>
                  ) : (
                    cell
                  )}
                </td>
              ))}
              <td className="whitespace-nowrap px-2 py-1 text-muted">{item.tab}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rowCount > items.length ? (
        <p className="px-2 py-1 text-xs text-muted">
          Showing the latest {items.length} of {rowCount.toLocaleString("en-US")}.
        </p>
      ) : null}
    </div>
  );
}
