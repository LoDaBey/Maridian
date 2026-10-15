"use client";

import { useCallback, useEffect, useState } from "react";
import type { SheetColumnRef } from "@/lib/sheets/csv";
import { ImportFileStep } from "./ImportFileStep";
import { ImportMapStep } from "./ImportMapStep";
import { ImportPreviewStep } from "./ImportPreviewStep";
import { useSheetImport } from "./useSheetImport";

export function ImportDialog({
  open,
  sheetId = "",
  sheetName,
  columns,
  createOnly = false,
  onClose,
  onBack,
}: {
  open: boolean;
  sheetId?: string;
  sheetName: string;
  columns: SheetColumnRef[];
  createOnly?: boolean;
  onClose: () => void;
  onBack?: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const importer = useSheetImport({
    active: open,
    sheetId,
    sheetName,
    columns,
    createOnly,
    onClose,
  });

  const dismiss = useCallback(() => {
    if (onBack && createOnly) {
      onBack();
      return;
    }
    onClose();
  }, [onBack, createOnly, onClose]);

  useEffect(() => {
    if (!open) {
      setStep(1);
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !importer.pending) {
        dismiss();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, importer.pending, dismiss]);

  if (!open) {
    return null;
  }

  const message = importer.error || importer.planError;
  const canGoNext =
    step === 1
      ? importer.hasFile
      : importer.hasFile && !importer.planError && Boolean(importer.readyPlan);
  const canImport =
    !importer.pending &&
    importer.readyPlans.length > 0 &&
    importer.readyPlans.some((plan) => plan.columns.length > 0);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-labelledby="import-title"
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col rounded-md border border-border bg-surface p-5 text-sm text-text shadow-sm"
      >
        <h2 id="import-title" className="text-base font-semibold">
          Import spreadsheet
        </h2>
        <p className="mt-1 text-xs text-muted">Step {step} of 3</p>
        {message ? (
          <p role="alert" className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-danger">
            {message}
          </p>
        ) : null}
        {step === 1 ? (
          <ImportFileStep
            disabled={importer.pending}
            fileLabel={importer.fileLabel}
            sheets={importer.sheetSummaries}
            importAllSheets={importer.importAllTabs}
            activeSheet={importer.activeSheet}
            onFile={(file) => void importer.onFile(file)}
            onSheetChange={importer.onSheetChange}
          />
        ) : null}
        {step === 2 ? (
          <ImportMapStep
            createOnly={createOnly}
            target={importer.target}
            newName={importer.newName}
            choices={importer.choices}
            rows={importer.rows}
            columns={columns}
            sheetNames={importer.importAllTabs ? importer.sheetNames : []}
            activeSheet={importer.activeSheet}
            onNameChange={importer.setNewName}
            onTargetChange={importer.chooseTarget}
            onColumnChange={importer.chooseColumn}
            onTypeChange={importer.chooseType}
            onSheetChange={importer.importAllTabs ? importer.onSheetChange : undefined}
          />
        ) : null}
        {step === 3 && importer.readyPlan ? (
          <ImportPreviewStep
            plan={importer.readyPlan}
            plans={importer.importAllTabs ? importer.readyPlans : [importer.readyPlan]}
            sheetNames={importer.importAllTabs ? importer.sheetNames : []}
            activeSheet={importer.activeSheet}
            progress={importer.progress}
            onSheetChange={importer.importAllTabs ? importer.onSheetChange : undefined}
          />
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" aria-label="Close import" className="cursor-pointer rounded-lg px-3 py-1.5" onClick={dismiss} disabled={importer.pending}>
            {onBack && createOnly ? "Back" : "Close"}
          </button>
          {step > 1 ? (
            <button
              type="button"
              aria-label="Back"
              className="cursor-pointer rounded-lg border border-border bg-surface px-3 py-1.5 text-text"
              disabled={importer.pending}
              onClick={() => setStep((current) => (current === 3 ? 2 : 1))}
            >
              Back
            </button>
          ) : null}
          {step < 3 ? (
            <button
              type="button"
              aria-label="Next"
              className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!canGoNext}
              onClick={() => setStep((current) => (current === 1 ? 2 : 3))}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              aria-label="Import"
              className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!canImport}
              onClick={() => void importer.onImport()}
            >
              Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
