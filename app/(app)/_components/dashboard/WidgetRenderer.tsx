"use client";

import type { WidgetConfig } from "@/lib/analytics/widgets";
import type { WidgetData } from "@/lib/dashboards/repo";
import {
  BarChart,
  ColumnChart,
  FunnelChart,
  HistogramChart,
  LeaderboardChart,
  Stacked100Chart,
  StackedColumnChart,
  WaterfallChart,
} from "@/components/charts/CategoryCharts";
import { CountryMapChart } from "@/components/charts/CountryMap";
import { CalendarHeatmap, MatrixHeatmap, ScatterChart, WorkloadChart } from "@/components/charts/PatternCharts";
import { EmptyChart } from "@/components/charts/primitives";
import { BatteryChart, DonutChart, TreemapChart } from "@/components/charts/ShareCharts";
import { GaugeChart, ItemListChart, KpiChart, PivotChart } from "@/components/charts/TableCharts";
import { AreaChart, CumulativeChart, LineChart, MultiLineChart } from "@/components/charts/TrendCharts";

export function WidgetRenderer({
  config,
  data,
  height,
  onDrill,
}: {
  config: WidgetConfig;
  data: WidgetData;
  height: number;
  onDrill?: (k1: string, k2?: string) => void;
}) {
  if (data.type === "empty") {
    return <EmptyChart message={data.message} />;
  }
  if (data.type === "list") {
    return <ItemListChart columns={data.columns} items={data.items} rowCount={data.rowCount} height={height} />;
  }
  if (data.type === "scatter") {
    return (
      <ScatterChart
        points={data.points}
        xLabel={config.options.x?.name ?? "X"}
        yLabel={config.options.y?.name ?? "Y"}
        height={height}
      />
    );
  }
  const props = {
    result: data.result,
    measure: config.measure,
    labels: config.options.labels ?? true,
    goal: config.options.goal,
    onDrill,
    height,
  };
  const items = `${data.result.rowCount.toLocaleString("en-US")} item${data.result.rowCount === 1 ? "" : "s"}`;
  switch (config.kind) {
    case "kpi":
      return <KpiChart result={data.result} measure={config.measure} previous={data.previous} caption={items} />;
    case "gauge":
      return <GaugeChart result={data.result} measure={config.measure} goal={config.options.goal} />;
    case "bar":
      return <BarChart {...props} />;
    case "column":
      return <ColumnChart {...props} />;
    case "stacked_column":
      return <StackedColumnChart {...props} />;
    case "stacked_100":
      return <Stacked100Chart {...props} />;
    case "line":
      return <LineChart {...props} />;
    case "multi_line":
      return <MultiLineChart {...props} />;
    case "area":
      return <AreaChart {...props} />;
    case "cumulative":
      return <CumulativeChart {...props} />;
    case "waterfall":
      return <WaterfallChart {...props} />;
    case "battery":
      return <BatteryChart {...props} />;
    case "donut":
      return <DonutChart {...props} />;
    case "treemap":
      return <TreemapChart {...props} />;
    case "funnel":
      return <FunnelChart {...props} />;
    case "leaderboard":
      return <LeaderboardChart {...props} trend={data.trend} />;
    case "calendar_heatmap":
      return <CalendarHeatmap {...props} />;
    case "matrix_heatmap":
      return <MatrixHeatmap {...props} />;
    case "histogram":
      return <HistogramChart {...props} bins={config.options.bins} />;
    case "workload":
      return <WorkloadChart {...props} capacity={config.options.capacity} />;
    case "country_map":
      return <CountryMapChart {...props} />;
    case "pivot":
      return <PivotChart {...props} />;
    default:
      return <EmptyChart message="This widget type isn't supported." />;
  }
}

/** Plain CSV of a widget's numbers (or items), for "Export CSV". */
export function widgetCsv(config: WidgetConfig, data: WidgetData): string {
  const escape = (value: string | number) => {
    const text = String(value);
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines: string[][] = [];
  if (data.type === "list") {
    lines.push([...data.columns, "Tab"]);
    for (const item of data.items) {
      lines.push([...item.cells, item.tab]);
    }
  } else if (data.type === "scatter") {
    lines.push([config.options.x?.name ?? "X", config.options.y?.name ?? "Y"]);
    for (const point of data.points) {
      lines.push([String(point.x), String(point.y)]);
    }
  } else if (data.type === "agg") {
    const { result } = data;
    if (result.series.length > 0) {
      lines.push(["", ...result.series.map((item) => item.label)]);
      for (const bucket of result.buckets) {
        lines.push([
          bucket.label,
          ...result.series.map((item) =>
            String(result.cells.filter((cell) => cell.k1 === bucket.key && cell.k2 === item.key).reduce((sum, cell) => sum + cell.value, 0)),
          ),
        ]);
      }
    } else if (result.buckets.length > 0) {
      lines.push(["", "Value"]);
      for (const bucket of result.buckets) {
        lines.push([
          bucket.label,
          String(result.cells.filter((cell) => cell.k1 === bucket.key).reduce((sum, cell) => sum + cell.value, 0)),
        ]);
      }
    } else {
      lines.push(["Total", String(result.total)]);
    }
  }
  return `﻿${lines.map((line) => line.map(escape).join(",")).join("\r\n")}`;
}
