import { notFound } from "next/navigation";
import { listWidgets } from "@/lib/dashboards/repo";
import { DashboardView } from "../../../../_components/dashboard/DashboardView";
import { loadDashboardContext } from "../data";

export const instant = false;

export default async function DashboardPage({ params }: { params: Promise<{ workspaceId: string; dashboardId: string }> }) {
  const { workspaceId, dashboardId } = await params;
  const context = await loadDashboardContext(workspaceId);
  const dashboard = context.dashboards.find((item) => item.id === dashboardId);
  if (!dashboard) {
    notFound();
  }
  const widgets = await listWidgets(dashboard.id);
  return (
    <DashboardView
      key={dashboard.id}
      workspace={{ id: context.workspace.id, name: context.workspace.name }}
      dashboards={context.dashboards}
      dashboard={dashboard}
      widgets={widgets}
      sources={context.sources}
      people={context.people}
      canEdit={context.canEdit}
    />
  );
}
