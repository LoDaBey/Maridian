import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { query } from "@/lib/db";
import { visibleTabSql, visibleWorkbooksSql } from "@/lib/sheets/workbook-access";
import type { Role } from "@/lib/rbac";

interface Kpi {
  label: string;
  value: number;
  /** Change vs the 7 days before, when it makes sense. */
  previous?: number;
  caption: string;
}

async function loadKpis(viewer: { id: string; role: Role }, workspaceId: string): Promise<Kpi[]> {
  const rows = await query<{ total: string; new7: string; new_prev: string; upd7: string; upd_prev: string; people7: string }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE r.created_at >= now() - interval '7 days')::text AS new7,
            count(*) FILTER (WHERE r.created_at >= now() - interval '14 days' AND r.created_at < now() - interval '7 days')::text AS new_prev,
            count(*) FILTER (WHERE r.updated_at >= now() - interval '7 days')::text AS upd7,
            count(*) FILTER (WHERE r.updated_at >= now() - interval '14 days' AND r.updated_at < now() - interval '7 days')::text AS upd_prev,
            count(DISTINCT r.updated_by) FILTER (WHERE r.updated_at >= now() - interval '7 days')::text AS people7
     FROM monitor_rows r
     JOIN monitor_sheets s ON s.id = r.sheet_id AND s.archived_at IS NULL
     JOIN monitor_workbooks w ON w.id = s.workbook_id
     WHERE r.deleted_at IS NULL AND w.workspace_id = $2 AND w.archived_at IS NULL AND w.deleted_at IS NULL
       AND ${visibleWorkbooksSql(viewer)} AND ${visibleTabSql(viewer)}`,
    [viewer.id, workspaceId],
  );
  const row = rows[0];
  const number = (value: string | undefined) => Number(value ?? 0);
  return [
    { label: "Items", value: number(row?.total), caption: "in sheets you can open" },
    { label: "Added this week", value: number(row?.new7), previous: number(row?.new_prev), caption: "vs the week before" },
    { label: "Updated this week", value: number(row?.upd7), previous: number(row?.upd_prev), caption: "vs the week before" },
    { label: "Active people", value: number(row?.people7), caption: "edited something this week" },
  ];
}

function Change({ value, previous }: { value: number; previous: number }) {
  if (previous === 0 && value === 0) {
    return null;
  }
  const delta = previous === 0 ? null : Math.round(((value - previous) / previous) * 100);
  const Icon = delta === null || delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
  const tone = delta === null || delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-muted";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${tone}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      {delta === null ? "new" : `${Math.abs(delta)}%`}
    </span>
  );
}

/** Four headline numbers for a workspace's home page. */
export async function WorkspaceKpis({ viewer, workspaceId }: { viewer: { id: string; role: Role }; workspaceId: string }) {
  const kpis = await loadKpis(viewer, workspaceId);
  return (
    <section aria-label="This week" className="grid grid-cols-2 gap-3 px-6 pt-5 lg:grid-cols-4">
      {kpis.map((kpi) => (
        <div key={kpi.label} className="rounded-xl border border-border bg-surface p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
          <p className="text-xs font-medium text-muted">{kpi.label}</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums tracking-tight">{kpi.value.toLocaleString("en-US")}</span>
            {kpi.previous !== undefined ? <Change value={kpi.value} previous={kpi.previous} /> : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">{kpi.caption}</p>
        </div>
      ))}
    </section>
  );
}

export function WorkspaceKpisSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 gap-3 px-6 pt-5 lg:grid-cols-4">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="h-[92px] animate-pulse rounded-xl border border-border bg-surface" />
      ))}
    </div>
  );
}
