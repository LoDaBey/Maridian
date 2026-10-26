import { redirect } from "next/navigation";

export const instant = false;

/** The old single-dashboard address. */
export default async function OldDashboardPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  redirect(`/w/${workspaceId}/dashboards`);
}
