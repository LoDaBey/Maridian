"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { LayoutDashboard, Users, X, Square } from "lucide-react";
import { createDashboardAction } from "@/app/(app)/w/[workspaceId]/dashboards/actions";
import type { DashboardSource } from "@/lib/dashboards/repo";
import { DASHBOARD_TEMPLATES, TEMPLATE_INFO, type DashboardTemplate } from "@/lib/dashboards/template-info";

const ICONS: Record<DashboardTemplate, typeof Users> = { operations: LayoutDashboard, team: Users, blank: Square };

export function NewDashboardDialog({
  workspaceId,
  sources,
  onClose,
}: {
  workspaceId: string;
  sources: DashboardSource[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [template, setTemplate] = useState<DashboardTemplate>("operations");
  const [name, setName] = useState("");
  const [workbookIds, setWorkbookIds] = useState<string[]>(sources[0] ? [sources[0].id] : []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError("");
    const result = await createDashboardAction({ workspaceId, name: name.trim() || TEMPLATE_INFO[template].name, template, workbookIds });
    if (result.error || !result.id) {
      setBusy(false);
      setError(result.error || "Couldn't create the dashboard.");
      return;
    }
    router.push(`/w/${workspaceId}/dashboards/${result.id}`);
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="ltr" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="New dashboard" className="w-full max-w-xl rounded-2xl bg-surface p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">New dashboard</h2>
          <button type="button" aria-label="Close" className="cursor-pointer rounded-md p-1.5 hover:bg-row" onClick={onClose}>
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          {DASHBOARD_TEMPLATES.map((item) => {
            const Icon = ICONS[item];
            return (
              <button
                key={item}
                type="button"
                aria-pressed={template === item}
                className={`cursor-pointer rounded-xl border p-3 text-start transition-colors ${template === item ? "border-primary bg-primary/5" : "border-border hover:bg-row"}`}
                onClick={() => setTemplate(item)}
              >
                <Icon className={`mb-2 size-5 ${template === item ? "text-primary" : "text-muted"}`} aria-hidden="true" />
                <p className="text-sm font-medium">{TEMPLATE_INFO[item].name}</p>
                <p className="mt-0.5 text-xs text-muted">{TEMPLATE_INFO[item].description}</p>
              </button>
            );
          })}
        </div>
        <label className="mb-1 block text-xs font-medium text-muted" htmlFor="dashboard-name">
          Name
        </label>
        <input
          id="dashboard-name"
          dir="auto"
          value={name}
          placeholder={TEMPLATE_INFO[template].name}
          className="mb-4 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          onChange={(event) => setName(event.target.value)}
        />
        {template !== "blank" ? (
          <>
            <p className="mb-1 text-xs font-medium text-muted">Build it from</p>
            <ul className="mb-4 max-h-44 space-y-1 overflow-auto rounded-md border border-border p-2">
              {sources.length === 0 ? <li className="text-sm text-muted">No sheets in this workspace yet.</li> : null}
              {sources.map((source) => {
                const on = workbookIds.includes(source.id);
                return (
                  <li key={source.id}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={on}
                        onChange={() => setWorkbookIds(on ? workbookIds.filter((id) => id !== source.id) : [...workbookIds, source.id])}
                      />
                      <span dir="auto" className="truncate">{source.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          {error ? (
            <p role="alert" className="me-auto text-sm text-danger">
              {error}
            </p>
          ) : null}
          <button type="button" className="cursor-pointer rounded-md px-3 py-1.5 text-sm hover:bg-row" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || (template !== "blank" && workbookIds.length === 0)}
            className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void create()}
          >
            {busy ? "Creating…" : "Create dashboard"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
