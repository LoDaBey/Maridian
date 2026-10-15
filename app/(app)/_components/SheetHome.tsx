"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ArchivedWorkbooksDialog } from "./ArchivedWorkbooksDialog";
import { can, canDeleteWorkbook, type Role } from "@/lib/rbac";
import { DeleteTemplateDialog } from "./DeleteTemplateDialog";
import { DeleteWorkbookDialog } from "./DeleteWorkbookDialog";
import { EmptyState } from "./EmptyState";
import { NewSheetDialog } from "./NewSheetDialog";
import { SaveAsTemplateDialog } from "./SaveAsTemplateDialog";
import { ShareWorkbookDialog } from "./ShareWorkbookDialog";
import { TemplateCard } from "./TemplateCard";
import { WorkbookCard } from "./WorkbookCard";
import type { SavedTemplateSummary, WorkbookSummary } from "@/lib/sheets/sheets-repo";

function suggestedName(workbooks: WorkbookSummary[]): string {
  const taken = new Set(workbooks.map((workbook) => workbook.name));
  let number = workbooks.length + 1;
  while (taken.has(`Sheet ${number}`)) {
    number += 1;
  }
  return `Sheet ${number}`;
}

function nameFromTemplate(templateName: string, workbooks: WorkbookSummary[]): string {
  const taken = new Set(workbooks.map((workbook) => workbook.name));
  const base = templateName.replace(/\s+template$/i, "").trim() || templateName;
  if (!taken.has(base)) {
    return base;
  }
  let number = 2;
  while (taken.has(`${base} ${number}`)) {
    number += 1;
  }
  return `${base} ${number}`;
}

export function SheetHome({
  workbooks,
  archived,
  savedTemplates,
  canCreate,
  canRestore,
  currentUserId,
  role,
}: {
  workbooks: WorkbookSummary[];
  archived: WorkbookSummary[];
  savedTemplates: SavedTemplateSummary[];
  canCreate: boolean;
  canRestore: boolean;
  currentUserId: string;
  role: Role;
}) {
  const [open, setOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [saving, setSaving] = useState<WorkbookSummary | null>(null);
  const [deleting, setDeleting] = useState<WorkbookSummary | null>(null);
  const [sharing, setSharing] = useState<WorkbookSummary | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<SavedTemplateSummary | null>(null);
  const canDeleteTemplate = can(role, "template.delete");
  const nextName = suggestedName(workbooks);

  if (workbooks.length === 0 && savedTemplates.length === 0) {
    return (
      <>
        <EmptyState
          canCreate={canCreate}
          suggestedName={nextName}
          savedTemplates={savedTemplates}
        />
        {canRestore ? (
          <div className="flex justify-center pb-10">
            <button
              type="button"
              aria-label="Archived sheets"
              className="cursor-pointer rounded-lg px-3 py-2 text-sm text-muted hover:text-text"
              onClick={() => setArchivedOpen(true)}
            >
              Archived sheets
            </button>
            {archivedOpen ? (
              <ArchivedWorkbooksDialog
                workbooks={archived}
                onClose={() => setArchivedOpen(false)}
              />
            ) : null}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Sheets</h1>
          <p className="mt-1 text-sm text-muted">Open a sheet to start working.</p>
        </div>
        <div className="flex items-center gap-2">
          {canRestore ? (
            <button
              type="button"
              aria-label="Archived sheets"
              className="cursor-pointer rounded-lg px-3.5 py-2 text-sm text-muted hover:text-text"
              onClick={() => setArchivedOpen(true)}
            >
              Archived
            </button>
          ) : null}
          {canCreate ? (
            <button
              type="button"
              aria-label="Create sheet"
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white"
              onClick={() => setOpen(true)}
            >
              <Plus className="size-4" aria-hidden="true" />
              New sheet
            </button>
          ) : null}
        </div>
      </div>
      {workbooks.length === 0 ? (
        <p className="mt-8 text-sm text-muted">No sheets yet. Use a template below or create a new sheet.</p>
      ) : (
        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workbooks.map((workbook) => (
            <WorkbookCard
              key={workbook.id}
              workbook={workbook}
              canSaveTemplate={canCreate}
              canDelete={canDeleteWorkbook({ id: currentUserId, role }, workbook)}
              onSaveTemplate={setSaving}
              onDelete={setDeleting}
              onShare={setSharing}
            />
          ))}
        </ul>
      )}
      {savedTemplates.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-lg font-semibold tracking-tight text-text">Templates</h2>
          <p className="mt-1 text-sm text-muted">Saved layouts you can use to create a new sheet.</p>
          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {savedTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                suggestedName={nameFromTemplate(template.name, workbooks)}
                canUse={canCreate}
                canDelete={canDeleteTemplate}
                onDelete={setDeletingTemplate}
              />
            ))}
          </ul>
        </section>
      ) : null}
      <NewSheetDialog
        key={open ? nextName : "closed"}
        open={open}
        suggestedName={nextName}
        savedTemplates={savedTemplates}
        onClose={() => setOpen(false)}
      />
      <SaveAsTemplateDialog
        open={saving !== null}
        workbookId={saving?.id ?? ""}
        suggestedName={saving ? `${saving.name} template` : "Template"}
        onClose={() => setSaving(null)}
      />
      <DeleteWorkbookDialog
        open={deleting !== null}
        workbookId={deleting?.id ?? ""}
        workbookName={deleting?.name ?? "Sheet"}
        onClose={() => setDeleting(null)}
      />
      <ShareWorkbookDialog
        open={sharing !== null}
        workbookId={sharing?.id ?? ""}
        workbookName={sharing?.name ?? "Sheet"}
        onClose={() => setSharing(null)}
      />
      <DeleteTemplateDialog
        open={deletingTemplate !== null}
        templateId={deletingTemplate?.id ?? ""}
        templateName={deletingTemplate?.name ?? "Template"}
        onClose={() => setDeletingTemplate(null)}
      />
      {archivedOpen ? (
        <ArchivedWorkbooksDialog workbooks={archived} onClose={() => setArchivedOpen(false)} />
      ) : null}
    </main>
  );
}
