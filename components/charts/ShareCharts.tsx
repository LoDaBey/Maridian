"use client";

import { useState } from "react";
import {
  bucketTotals,
  colorFor,
  EmptyChart,
  fmt,
  Legend,
  pct,
  Tip,
  useWidth,
  type ChartProps,
  type TipState,
} from "./primitives";

/** Monday-style battery: one bar split into parts, the legend carries the numbers. */
export function BatteryChart({ result, measure, onDrill }: ChartProps) {
  const [tip, setTip] = useState<TipState | null>(null);
  const parts = bucketTotals(result).filter((part) => part.value > 0);
  if (parts.length === 0) {
    return <EmptyChart />;
  }
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <div className="flex h-8 w-full gap-[2px]">
        {parts.map((part, index) => (
          <button
            key={part.key}
            type="button"
            aria-label={`${part.label}: ${fmt(part.value, measure)} (${pct(part.value, total)})`}
            className={`h-full min-w-[3px] first:rounded-s-[4px] last:rounded-e-[4px] ${onDrill ? "cursor-pointer" : "cursor-default"}`}
            style={{ flexGrow: part.value, flexBasis: 0, backgroundColor: colorFor(part, index) }}
            onMouseEnter={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const parent = event.currentTarget.parentElement!.getBoundingClientRect();
              setTip({
                x: box.left - parent.left + box.width / 2,
                y: 0,
                title: part.label,
                lines: [`${fmt(part.value, measure)} · ${pct(part.value, total)}`],
              });
            }}
            onClick={() => onDrill?.(part.key)}
          />
        ))}
      </div>
      <Legend
        items={parts.map((part, index) => ({
          key: part.key,
          label: part.label,
          color: colorFor(part, index),
          value: `${fmt(part.value, measure)} · ${pct(part.value, total)}`,
        }))}
      />
      <Tip tip={tip} />
    </div>
  );
}

/** Donut for up to 6 parts (the server folds the rest into "Other"). */
export function DonutChart({ result, measure, onDrill, height }: ChartProps) {
  const [active, setActive] = useState<string | null>(null);
  const parts = bucketTotals(result).filter((part) => part.value > 0);
  if (parts.length === 0) {
    return <EmptyChart />;
  }
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const size = Math.min(height, 200);
  const radius = size / 2;
  const inner = radius * 0.62;
  const starts = parts.reduce<number[]>((list, part, index) => [...list, (list[index - 1] ?? -Math.PI / 2) + (index > 0 ? (parts[index - 1]!.value / total) * Math.PI * 2 : 0)], []);
  const arcs = parts.map((part, index) => {
    const sweep = (part.value / total) * Math.PI * 2;
    const start = starts[index]!;
    const end = start + sweep;
    // A 2px surface gap between slices comes from the stroke.
    const large = sweep > Math.PI ? 1 : 0;
    const point = (r: number, a: number) => `${radius + r * Math.cos(a)},${radius + r * Math.sin(a)}`;
    const d = `M${point(radius, start)} A${radius},${radius} 0 ${large} 1 ${point(radius, end)} L${point(inner, end)} A${inner},${inner} 0 ${large} 0 ${point(inner, start)} Z`;
    return { part, d, color: colorFor(part, index) };
  });
  const shown = parts.find((part) => part.key === active);
  return (
    <div className="flex h-full min-w-0 items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Donut chart" className="h-auto min-w-0 max-w-[55%] shrink">
        {arcs.length === 1 ? (
          <circle
            cx={radius}
            cy={radius}
            r={(radius + inner) / 2}
            fill="none"
            stroke={arcs[0]!.color}
            strokeWidth={radius - inner}
            className={onDrill ? "cursor-pointer" : undefined}
            onClick={() => onDrill?.(arcs[0]!.part.key)}
          />
        ) : null}
        {arcs.length > 1 && arcs.map((arc) => (
          <path
            key={arc.part.key}
            d={arc.d}
            fill={arc.color}
            stroke="var(--surface)"
            strokeWidth={2}
            opacity={active && active !== arc.part.key ? 0.45 : 1}
            className={onDrill ? "cursor-pointer" : undefined}
            onMouseEnter={() => setActive(arc.part.key)}
            onMouseLeave={() => setActive(null)}
            onClick={() => onDrill?.(arc.part.key)}
          />
        ))}
        <text x={radius} y={radius - 4} textAnchor="middle" fontSize={20} fontWeight={600} fill="var(--text)">
          {fmt(shown ? shown.value : total, measure)}
        </text>
        <text x={radius} y={radius + 14} textAnchor="middle" fontSize={11} fill="var(--muted)">
          {shown ? pct(shown.value, total) : "Total"}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1 text-xs">
        {arcs.map((arc) => (
          <li key={arc.part.key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: arc.color }} />
            <span dir="auto" className="min-w-0 flex-1 truncate text-text">
              {arc.part.label}
            </span>
            <span className="tabular-nums text-muted">{pct(arc.part.value, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Squarified treemap layout (Bruls et al.), good aspect ratios for many parts. */
function squarify(values: number[], box: Rect): Rect[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return values.map(() => ({ x: box.x, y: box.y, w: 0, h: 0 }));
  }
  const scaled = values.map((value) => (value / total) * box.w * box.h);
  const out: Rect[] = new Array(values.length);
  let rect = { ...box };
  let index = 0;
  while (index < scaled.length) {
    const side = Math.min(rect.w, rect.h);
    let row = [index];
    let best = worst([scaled[index]!], side);
    while (index + row.length < scaled.length) {
      const next = [...row, index + row.length];
      const score = worst(next.map((i) => scaled[i]!), side);
      if (score > best) {
        break;
      }
      row = next;
      best = score;
    }
    const area = row.reduce((sum, i) => sum + scaled[i]!, 0);
    if (rect.w >= rect.h) {
      const w = area / rect.h;
      let y = rect.y;
      for (const i of row) {
        const h = scaled[i]! / w;
        out[i] = { x: rect.x, y, w, h };
        y += h;
      }
      rect = { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h };
    } else {
      const h = area / rect.w;
      let x = rect.x;
      for (const i of row) {
        const w = scaled[i]! / h;
        out[i] = { x, y: rect.y, w, h };
        x += w;
      }
      rect = { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h };
    }
    index += row.length;
  }
  return out;
}

function worst(row: number[], side: number): number {
  const sum = row.reduce((total, value) => total + value, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

export function TreemapChart({ result, measure, onDrill, height }: ChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const parts = bucketTotals(result)
    .filter((part) => part.value > 0)
    .sort((a, b) => b.value - a.value);
  if (parts.length === 0) {
    return <EmptyChart />;
  }
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const rects = width > 0 ? squarify(parts.map((part) => part.value), { x: 0, y: 0, w: width, h: height }) : [];
  return (
    <div ref={ref} className="relative w-full" style={{ height }} onMouseLeave={() => setTip(null)}>
      {rects.map((rect, index) => {
        const part = parts[index]!;
        const roomy = rect.w > 70 && rect.h > 34;
        return (
          <button
            key={part.key}
            type="button"
            aria-label={`${part.label}: ${fmt(part.value, measure)}`}
            className={`absolute overflow-hidden rounded-[4px] p-1.5 text-start ${onDrill ? "cursor-pointer" : "cursor-default"}`}
            style={{
              left: rect.x + 1,
              top: rect.y + 1,
              width: Math.max(0, rect.w - 2),
              height: Math.max(0, rect.h - 2),
              backgroundColor: colorFor(part, index),
            }}
            onMouseEnter={() =>
              setTip({ x: rect.x + rect.w / 2, y: rect.y + 4, title: part.label, lines: [`${fmt(part.value, measure)} · ${pct(part.value, total)}`] })
            }
            onClick={() => onDrill?.(part.key)}
          >
            {roomy ? (
              <span className="block text-[11px] font-medium leading-tight text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.35)]">
                <span dir="auto" className="block truncate">
                  {part.label}
                </span>
                <span className="tabular-nums opacity-90">{pct(part.value, total)}</span>
              </span>
            ) : null}
          </button>
        );
      })}
      <Tip tip={tip} />
    </div>
  );
}
