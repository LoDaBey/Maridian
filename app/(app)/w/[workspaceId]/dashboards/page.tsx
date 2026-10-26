import { redirect } from "next/navigation";
import { DashboardsEmpty } from "../../../_components/dashboard/DashboardsEmpty";
import { loadDashboardContext } from "./data";

export const instant = false;

export default async function DashboardsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const context = await loadDashboardContext(workspaceId);
  if (context.dashboards[0]) {
    redirect(`/w/${context.workspace.id}/dashboards/${context.dashboards[0].id}`);
  }
  return <DashboardsEmpty workspaceId={context.workspace.id} sources={context.sources} canEdit={context.canEdit} />;
}
