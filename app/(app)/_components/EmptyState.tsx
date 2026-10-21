"use client";

import { useState } from "react";
import { NewSheetDialog } from "./NewSheetDialog";
import type { SavedTemplateSummary } from "@/lib/sheets/sheets-repo";

export function EmptyState({
  workspaceId,
  canCreate,
  suggestedName,
  savedTemplates = [],
}: {
  workspaceId: string;
  canCreate: boolean;
  suggestedName: string;
  savedTemplates?: SavedTemplateSummary[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm">
      <h1 className="text-lg font-semibold">No sheets yet</h1>
      {canCreate ? (
        <button
          type="button"
          aria-label="Create sheet"
          className="cursor-pointer rounded-md bg-primary px-4 py-2 font-medium text-white"
          onClick={() => setOpen(true)}
        >
          Create sheet
        </button>
      ) : (
        <p className="text-muted">Ask a project manager to create one.</p>
      )}
      <NewSheetDialog
        workspaceId={workspaceId}
        key={open ? suggestedName : "closed"}
        open={open}
        suggestedName={suggestedName}
        savedTemplates={savedTemplates}
        onClose={() => setOpen(false)}
      />
    </main>
  );
}
