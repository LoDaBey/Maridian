"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { ImportFileStep } from "@/app/(app)/s/[sheetId]/_components/ImportFileStep";
import { ImportMapStep } from "@/app/(app)/s/[sheetId]/_components/ImportMapStep";
import { ImportPreviewStep } from "@/app/(app)/s/[sheetId]/_components/ImportPreviewStep";
import { useSheetImport } from "@/app/(app)/s/[sheetId]/_components/useSheetImport";
import { createSheet } from "@/app/(app)/sheets/actions";
import { ActionButton } from "@/components/grid/ActionButton";
import type { NewSheetChoice, NewSheetStep } from "@/lib/db-types";
import type { SavedTemplateSummary } from "@/lib/sheets/sheets-repo";
import { NewSheetNameStep } from "./new-sheet/NewSheetNameStep";
import { NewSheetProgress } from "./new-sheet/NewSheetProgress";
import { NewSheetReviewStep } from "./new-sheet/NewSheetReviewStep";
import { NewSheetStartStep } from "./new-sheet/NewSheetStartStep";

const CREATE_STEPS: Array<{ id: NewSheetStep; label: string }> = [
  { id: "name", label: "Name" },
  { id: "start", label: "Start" },
  { id: "review", label: "Create" },
];

const IMPORT_STEPS: Array<{ id: NewSheetStep; label: string }> = [
  { id: "name", label: "Name" },
  { id: "start", label: "Start" },
  { id: "file", label: "File" },
  { id: "map", label: "Map" },
  { id: "preview", label: "Import" },
];

export function NewSheetDialog({
  workspaceId,
  open,
  suggestedName,
  savedTemplates = [],
  onClose,
}: {
  workspaceId: string;
  open: boolean;
  suggestedName: string;
  savedTemplates?: SavedTemplateSummary[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(suggestedName);
  const [choice, setChoice] = useState<NewSheetChoice>("blank");
  const [step, setStep] = useState<NewSheetStep>("name");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const importer = useSheetImport({
    active: open && choice === "import",
    workspaceId,
    sheetName: name.trim(),
    columns: [],
    createOnly: true,
    onClose,
  });
  const steps = choice === "import" ? IMPORT_STEPS : CREATE_STEPS;
  const stepIndex = Math.max(steps.findIndex((item) => item.id === step), 0);
  const wide = step === "file" || step === "map" || step === "preview";
  const busy = pending || importer.pending;

  useEffect(() => {
    if (choice !== "import" && (step === "file" || step === "map" || step === "preview")) {
      setStep("start");
    }
  }, [choice, step]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, busy]);

  if (!open) {
    return null;
  }

  function goNext(): void {
    if (step === "name") {
      if (!name.trim()) {
        setError("Enter a sheet name.");
        return;
      }
      setError("");
      setStep("start");
      return;
    }
    if (step === "start") {
      setError("");
      setStep(choice === "import" ? "file" : "review");
      return;
    }
    if (step === "file") {
      if (!importer.hasFile) {
        setError("Choose an Excel or CSV file.");
        return;
      }
      setError("");
      setStep("map");
      return;
    }
    if (step === "map") {
      if (importer.planError) {
        setError(importer.planError);
        return;
      }
      setError("");
      setStep("preview");
      return;
    }
    if (step === "preview") {
      void importer.onImport();
      return;
    }
    void create();
  }

  function goBack(): void {
    setError("");
    importer.setError("");
    if (step === "preview") {
      setStep("map");
      return;
    }
    if (step === "map") {
      setStep("file");
      return;
    }
    if (step === "file" || step === "review") {
      setStep("start");
      return;
    }
    if (step === "start") {
      setStep("name");
    }
  }

  async function create(): Promise<void> {
    setPending(true);
    setError("");
    try {
      const result = choice.startsWith("saved:")
        ? await createSheet({ workspaceId, name: name.trim(), savedTemplateId: choice.slice("saved:".length) })
        : await createSheet({ workspaceId, name: name.trim(), template: "blank" });
      if (result.error || !result.id) {
        setError(result.error || "Could not create the sheet.");
        return;
      }
      onClose();
      router.push(`/s/${result.id}`);
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!busy) {
      goNext();
    }
  }

  const continueLabel = step === "preview" ? "Import" : step === "review" ? "Create sheet" : "Continue";
  const continueDisabled =
    busy ||
    (step === "file" && !importer.hasFile) ||
    (step === "map" && Boolean(importer.planError)) ||
    (step === "preview" &&
      (importer.readyPlans.length === 0 || importer.readyPlans.every((plan) => plan.columns.length === 0)));
  const message = error || importer.error || (step === "map" || step === "preview" ? importer.planError : "");

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close new sheet"
        className="absolute inset-0 cursor-pointer bg-black/50"
        disabled={busy}
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-sheet-title"
        aria-describedby="new-sheet-step"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        className={`relative z-10 flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl transition-[max-width] duration-200 ${
          wide ? "max-w-4xl" : "max-w-xl"
        }`}
      >
        <div className="shrink-0 border-b border-border bg-bg px-6 pb-5 pt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">New sheet</p>
          <NewSheetProgress step={step} steps={steps} />
        </div>
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                {step === "name" ? (
                  <NewSheetNameStep
                    name={name}
                    onChange={(next) => {
                      setName(next);
                      if (error) {
                        setError("");
                      }
                    }}
                  />
                ) : null}
                {step === "start" ? (
                  <NewSheetStartStep choice={choice} savedTemplates={savedTemplates} onSelect={setChoice} />
                ) : null}
                {step === "review" ? <NewSheetReviewStep name={name} choice={choice} savedTemplates={savedTemplates} /> : null}
                {step === "file" ? (
                  <div className="flex flex-col gap-2">
                    <h2 id="new-sheet-title" className="text-xl font-semibold tracking-tight">
                      Choose a file
                    </h2>
                    <p id="new-sheet-step" className="text-sm text-muted">
                      Upload an Excel or CSV file. Every workbook sheet will be imported as a tab.
                    </p>
                    <ImportFileStep
                      disabled={busy}
                      fileLabel={importer.fileLabel}
                      sheets={importer.sheetSummaries}
                      importAllSheets
                      activeSheet={importer.activeSheet}
                      onFile={(file) => {
                        setError("");
                        void importer.onFile(file);
                      }}
                      onSheetChange={importer.onSheetChange}
                    />
                  </div>
                ) : null}
                {step === "map" ? (
                  <div className="flex flex-col gap-2">
                    <h2 id="new-sheet-title" className="text-xl font-semibold tracking-tight">
                      Map columns
                    </h2>
                    <p id="new-sheet-step" className="text-sm text-muted">
                      Match each source column for every workbook sheet on {name.trim()}.
                    </p>
                    <ImportMapStep
                      createOnly
                      askName={false}
                      target={importer.target}
                      newName={importer.newName}
                      choices={importer.choices}
                      rows={importer.rows}
                      columns={[]}
                      sheetNames={importer.sheetNames}
                      activeSheet={importer.activeSheet}
                      onNameChange={importer.setNewName}
                      onTargetChange={importer.chooseTarget}
                      onColumnChange={importer.chooseColumn}
                      onTypeChange={importer.chooseType}
                      onSheetChange={importer.onSheetChange}
                    />
                  </div>
                ) : null}
                {step === "preview" && importer.readyPlan ? (
                  <div className="flex flex-col gap-2">
                    <h2 id="new-sheet-title" className="text-xl font-semibold tracking-tight">
                      Review the import
                    </h2>
                    <p id="new-sheet-step" className="text-sm text-muted">
                      Confirm the rows, then import them into {name.trim()}.
                    </p>
                    <ImportPreviewStep
                      plan={importer.readyPlan}
                      plans={importer.readyPlans}
                      sheetNames={importer.sheetNames}
                      activeSheet={importer.activeSheet}
                      progress={importer.progress}
                      onSheetChange={importer.onSheetChange}
                    />
                  </div>
                ) : null}
              </motion.div>
            </AnimatePresence>
            {message ? (
              <p role="alert" className="mt-4 text-sm text-danger">
                {message}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 px-6 pb-6 pt-4">
            <p className="text-xs text-muted">
              Step {stepIndex + 1} of {steps.length}
            </p>
            <div className="flex gap-2">
              {step === "name" ? (
                <ActionButton
                  type="button"
                  aria-label="Cancel new sheet"
                  className="cursor-pointer rounded-lg border border-border px-4 py-2 text-sm"
                  onClick={onClose}
                >
                  Cancel
                </ActionButton>
              ) : (
                <ActionButton
                  type="button"
                  aria-label="Back"
                  disabled={busy}
                  className="cursor-pointer rounded-lg border border-border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={goBack}
                >
                  Back
                </ActionButton>
              )}
              <ActionButton
                type="submit"
                aria-label={busy ? "Working" : continueLabel}
                disabled={continueDisabled}
                className="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? (step === "preview" ? "Importing..." : "Creating...") : continueLabel}
              </ActionButton>
            </div>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
