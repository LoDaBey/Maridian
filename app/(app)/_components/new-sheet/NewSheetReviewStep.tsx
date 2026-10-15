import type { NewSheetChoice } from "@/lib/db-types";
import type { SavedTemplateSummary } from "@/lib/sheets/sheets-repo";

export function NewSheetReviewStep({
  name,
  choice,
  savedTemplates,
}: {
  name: string;
  choice: NewSheetChoice;
  savedTemplates: SavedTemplateSummary[];
}) {
  const start = describeChoice(choice, savedTemplates);

  return (
    <div className="flex flex-col gap-2">
      <h2 id="new-sheet-title" className="text-xl font-semibold tracking-tight">
        Review and create
      </h2>
      <p id="new-sheet-step" className="text-sm text-muted">
        Confirm the details, then open the new sheet.
      </p>
      <dl className="mt-4 overflow-hidden rounded-lg border border-border">
        <div className="border-b border-border px-4 py-3">
          <dt className="text-xs font-medium text-muted">Sheet name</dt>
          <dd className="mt-1 text-sm font-semibold">{name.trim()}</dd>
        </div>
        <div className="px-4 py-3">
          <dt className="text-xs font-medium text-muted">Starts from</dt>
          <dd className="mt-1 text-sm font-semibold">{start.title}</dd>
          <dd className="mt-0.5 text-sm text-muted">{start.description}</dd>
        </div>
      </dl>
    </div>
  );
}

function describeChoice(choice: NewSheetChoice, savedTemplates: SavedTemplateSummary[]): { title: string; description: string } {
  if (choice === "import") {
    return { title: "Import", description: "You will map an Excel or CSV file next." };
  }
  if (choice === "blank") {
    return { title: "Blank", description: "A name column and empty rows." };
  }
  const saved = savedTemplates.find((template) => choice === `saved:${template.id}`);
  return {
    title: saved?.name ?? "Template",
    description: "Saved columns, groups, and empty rows.",
  };
}
