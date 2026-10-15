import { FileUp, LayoutTemplate, Table2 } from "lucide-react";
import type { NewSheetChoice } from "@/lib/db-types";
import type { SavedTemplateSummary } from "@/lib/sheets/sheets-repo";
import { NewSheetStartCard } from "./NewSheetStartCard";

export function NewSheetStartStep({
  choice,
  savedTemplates,
  onSelect,
}: {
  choice: NewSheetChoice;
  savedTemplates: SavedTemplateSummary[];
  onSelect: (choice: NewSheetChoice) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 id="new-sheet-title" className="text-xl font-semibold tracking-tight">
        Choose a starting point
      </h2>
      <p id="new-sheet-step" className="text-sm text-muted">
        Begin empty, bring in a file, or reuse a saved layout.
      </p>
      <div className="mt-4 max-h-80 overflow-x-hidden overflow-y-auto">
        <div className="flex flex-col gap-2 px-4 py-2">
          <NewSheetStartCard
            icon={Table2}
            title="Blank"
            description="A name column and empty rows. Add columns after the sheet opens."
            selected={choice === "blank"}
            onSelect={() => onSelect("blank")}
          />
          <NewSheetStartCard
            icon={FileUp}
            title="Import"
            description="Upload an Excel or CSV file and map its columns and rows."
            selected={choice === "import"}
            onSelect={() => onSelect("import")}
          />
          {savedTemplates.map((saved) => {
            const value = `saved:${saved.id}` as const;
            return (
              <NewSheetStartCard
                key={saved.id}
                icon={LayoutTemplate}
                title={saved.name}
                description="Saved columns, groups, and empty rows."
                selected={choice === value}
                onSelect={() => onSelect(value)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
