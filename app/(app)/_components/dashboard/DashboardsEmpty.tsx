"use client";

import { useState } from "react";
import { LayoutDashboard, Plus } from "lucide-react";
import type { DashboardSource } from "@/lib/dashboards/repo";
import { NewDashboardDialog } from "./NewDashboardDialog";

export function DashboardsEmpty({ workspaceId, sources, canEdit }: { workspaceId: string; sources: DashboardSource[]; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="max-w-md text-center">
        <LayoutDashboard className="mx-auto mb-3 size-10 text-primary" aria-hidden="true" />
        <h1 className="text-xl font-semibold">No dashboards yet</h1>
        <p className="mt-1 text-sm text-muted">
          {canEdit
            ? "Start from the operations template to get output, status, workload and stuck items from your sheets in one click."
            : "A workspace admin or project manager can create the first dashboard."}
        </p>
        {canEdit ? (
          <button type="button" className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90" onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden="true" /> New dashboard
          </button>
        ) : null}
      </div>
      {open ? <NewDashboardDialog workspaceId={workspaceId} sources={sources} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
