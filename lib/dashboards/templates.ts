/**
 * Ready-made dashboards built from a sheet's own columns, so a manager gets a useful
 * board in one click instead of configuring 10 widgets.
 */
import type { ColumnRef, Filter } from "@/lib/analytics/types";
import { DATE_TYPES, PERSON_TYPES } from "@/lib/analytics/types";
import type { WidgetConfig, WidgetKind } from "@/lib/analytics/widgets";
import { columnValues, type DashboardSource } from "./repo";
import type { Role } from "@/lib/rbac";

import { type DashboardTemplate } from "./template-info";

export { DASHBOARD_TEMPLATES, TEMPLATE_INFO, type DashboardTemplate } from "./template-info";

const DONE_WORDS = ["done", "complete", "completed", "finished", "تم", "مكتمل", "منجز", "منتهي"];
const STUCK_WORDS = ["stuck", "blocked", "متوقف", "معلق", "متأخر"];
const DONE_COLORS = ["#00c875", "#037f4c"];
const STUCK_COLORS = ["#e2445c", "#bb3354"];

interface Draft {
  title: string;
  kind: WidgetKind;
  dims?: WidgetConfig["dims"];
  measure?: WidgetConfig["measure"];
  filters?: Filter[];
  options?: WidgetConfig["options"];
  width?: number;
  height?: number;
}

export interface TemplateWidget {
  title: string;
  config: WidgetConfig;
  width?: number;
  height?: number;
}

/** Builds the widgets for a template from one or more sheets. */
export async function buildTemplate(input: {
  template: DashboardTemplate;
  viewer: { id: string; role: Role };
  sources: DashboardSource[];
  workbookIds: string[];
}): Promise<TemplateWidget[]> {
  if (input.template === "blank" || input.workbookIds.length === 0) {
    return [];
  }
  const columns = input.sources.filter((source) => input.workbookIds.includes(source.id)).flatMap((source) => source.columns);
  // Prefer the date and person columns that are actually filled in.
  const filled = async (candidates: ColumnRef[]) => {
    let best: ColumnRef | undefined;
    let most = 0;
    for (const candidate of candidates) {
      const count = (await columnValues({ viewer: input.viewer, workbookIds: input.workbookIds, ref: candidate })).length;
      if (count > most) {
        best = candidate;
        most = count;
      }
    }
    return best;
  };
  const date: ColumnRef = (await filled(columns.filter((column) => DATE_TYPES.has(column.type)))) ?? { name: "Created at", type: "created_at" };
  const person: ColumnRef = (await filled(columns.filter((column) => PERSON_TYPES.has(column.type)))) ?? { name: "Created by", type: "created_by" };
  const country = columns.find((column) => column.type === "country");
  const statuses = columns.filter((column) => column.type === "status");
  const numberColumn = columns.find((column) => column.type === "number");

  // Pick the status column that holds a "done" label, and another status as the report type.
  let status: ColumnRef | undefined;
  let doneKeys: string[] = [];
  let stuckKeys: string[] = [];
  const statusValues = [];
  for (const candidate of statuses) {
    const values = await columnValues({ viewer: input.viewer, workbookIds: input.workbookIds, ref: candidate });
    if (values.length > 0 && values.length <= 10) {
      statusValues.push({ candidate, values });
    }
  }
  // A "Done" label wins over a green colour; colour is only a fallback.
  const isWord = (label: string, words: string[]) => words.includes(label.trim().toLowerCase());
  for (const byColor of [false, true]) {
    for (const { candidate, values } of statusValues) {
      const done = values.filter((value) =>
        byColor ? DONE_COLORS.includes((value.color ?? "").toLowerCase()) : isWord(value.label, DONE_WORDS),
      );
      if (done.length > 0) {
        status = candidate;
        doneKeys = done.map((value) => value.key);
        stuckKeys = values
          .filter((value) => (byColor ? STUCK_COLORS.includes((value.color ?? "").toLowerCase()) : isWord(value.label, STUCK_WORDS)))
          .map((value) => value.key);
        break;
      }
    }
    if (status) {
      break;
    }
  }
  const type = statuses.find((column) => column !== status && column.name !== date.name);
  const thisMonth: Filter = { ref: date, op: "date_range", range: "this_month" };

  const drafts: Draft[] = [];
  if (input.template === "operations") {
    drafts.push(
      { title: "Items this month", kind: "kpi", filters: [thisMonth], options: { compare: true }, width: 3, height: 1 },
      ...(status && doneKeys.length > 0
        ? [{ title: "Done this month", kind: "kpi" as const, filters: [thisMonth, { ref: status, op: "any_of" as const, values: doneKeys }], options: { compare: true }, width: 3, height: 1 }]
        : []),
      { title: "Active editors this month", kind: "kpi", measure: { op: "distinct", column: person }, filters: [thisMonth], width: 3, height: 1 },
      ...(status && stuckKeys.length > 0
        ? [{ title: "Stuck right now", kind: "kpi" as const, filters: [{ ref: status, op: "any_of" as const, values: stuckKeys }], width: 3, height: 1 }]
        : numberColumn
          ? [{ title: `Total ${numberColumn.name} this month`, kind: "kpi" as const, measure: { op: "sum" as const, column: numberColumn }, filters: [thisMonth], options: { compare: true }, width: 3, height: 1 }]
          : []),
      { title: "Daily output", kind: "calendar_heatmap", dims: [{ ref: date, bucket: "day" }], filters: [{ ref: date, op: "date_range", range: "90d" }], width: 8, height: 2 },
      ...(status ? [{ title: `By ${status.name}`, kind: "donut" as const, dims: [{ ref: status }], width: 4, height: 2 }] : []),
      { title: "Top editors this month", kind: "leaderboard", dims: [{ ref: person }], filters: [thisMonth], options: { dateRef: date }, width: 4, height: 2 },
      ...(type
        ? [{ title: `Weekly mix by ${type.name}`, kind: "stacked_100" as const, dims: [{ ref: date, bucket: "week" as const }, { ref: type }], filters: [{ ref: date, op: "date_range" as const, range: "90d" as const }], width: 8, height: 2 }]
        : []),
      { title: "Items per week", kind: "area", dims: [{ ref: date, bucket: "week" }], filters: [{ ref: date, op: "date_range", range: "90d" }], width: 6, height: 2 },
      ...(country ? [{ title: `By ${country.name}`, kind: "country_map" as const, dims: [{ ref: country }], width: 6, height: 2 }] : []),
      ...(status && stuckKeys.length > 0
        ? [{ title: "Stuck items", kind: "item_list" as const, filters: [{ ref: status, op: "any_of" as const, values: stuckKeys }], width: 12, height: 2 }]
        : []),
    );
  } else {
    drafts.push(
      { title: "Leaderboard this month", kind: "leaderboard", dims: [{ ref: person }], filters: [thisMonth], options: { dateRef: date }, width: 4, height: 2 },
      { title: "Weekly workload", kind: "workload", dims: [{ ref: person }, { ref: date, bucket: "week" }], filters: [{ ref: date, op: "date_range", range: "30d" }], options: { capacity: 50 }, width: 8, height: 2 },
      ...(type
        ? [{ title: `Who works on what (${type.name})`, kind: "matrix_heatmap" as const, dims: [{ ref: person }, { ref: type }], filters: [thisMonth], width: 6, height: 2 }]
        : []),
      { title: "Items per week by person", kind: "multi_line", dims: [{ ref: date, bucket: "week" }, { ref: person }], filters: [{ ref: date, op: "date_range", range: "90d" }], width: 6, height: 2 },
      ...(status
        ? [{ title: `Status by person`, kind: "stacked_column" as const, dims: [{ ref: person }, { ref: status }], filters: [thisMonth], width: 12, height: 2 }]
        : []),
    );
  }

  return drafts.map((draft) => ({
    title: draft.title,
    width: draft.width,
    height: draft.height,
    config: {
      v: 2,
      kind: draft.kind,
      source: { workbookIds: input.workbookIds },
      dims: draft.dims ?? [],
      measure: draft.measure ?? { op: "count" },
      filters: draft.filters ?? [],
      options: { dateRef: date, personRef: person, ...(draft.options ?? {}) },
    },
  }));
}
