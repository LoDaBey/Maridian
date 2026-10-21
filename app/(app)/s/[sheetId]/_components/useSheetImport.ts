"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importRows, loadImportPeople } from "@/app/(app)/sheets/import-actions";
import type { ColumnType, ImportSheetSummary } from "@/lib/db-types";
import type { JsonValue } from "@/lib/sheets/ops";
import {
  IMPORT_CHUNK_SIZE,
  autoMapColumns,
  buildImport,
  type ColumnChoice,
  type ImportPerson,
  type ImportPlan,
  type SheetColumnRef,
} from "@/lib/sheets/csv";
import { loadSpreadsheet, type SpreadsheetWorkbook } from "@/lib/sheets/spreadsheet";

const DATE_FORMAT = "iso" as const;

type ImportTabState = {
  name: string;
  headers: string[];
  rows: string[][];
  choices: ColumnChoice[];
};

function buildChoices(
  headers: string[],
  rows: string[][],
  target: "append" | "new",
  columns: SheetColumnRef[],
  people: ImportPerson[],
): ColumnChoice[] {
  return autoMapColumns(headers, target === "new" ? [] : columns, rows, DATE_FORMAT, people, () => crypto.randomUUID());
}

export function useSheetImport({
  active,
  sheetId = "",
  workspaceId,
  sheetName,
  columns,
  createOnly = false,
  onClose,
}: {
  active: boolean;
  sheetId?: string;
  workspaceId?: string;
  sheetName: string;
  columns: SheetColumnRef[];
  createOnly?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const wasActive = useRef(false);
  const workbookRef = useRef<SpreadsheetWorkbook | null>(null);
  const [error, setError] = useState("");
  const [fileLabel, setFileLabel] = useState("");
  const [tabs, setTabs] = useState<ImportTabState[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [target, setTarget] = useState<"append" | "new">(createOnly ? "new" : "append");
  const [newName, setNewName] = useState("");
  const [people, setPeople] = useState<ImportPerson[]>([]);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    if (active && !wasActive.current) {
      setError("");
      setFileLabel("");
      setTabs([]);
      setActiveTabIndex(0);
      setTarget(createOnly ? "new" : "append");
      setNewName(sheetName.slice(0, 100));
      setPending(false);
      setProgress("");
      workbookRef.current = null;
      void loadImportPeople().then((result) => {
        if (result.error) {
          setError(result.error);
          return;
        }
        setPeople(result.people);
      });
    }
    wasActive.current = active;
  }, [active, createOnly, sheetName]);

  useEffect(() => {
    if (createOnly) {
      setNewName(sheetName.slice(0, 100));
    }
  }, [createOnly, sheetName]);

  const importAllTabs = createOnly || target === "new";
  const activeTab = tabs[activeTabIndex] ?? null;
  const sheetNames = tabs.map((tab) => tab.name);
  const sheetSummaries: ImportSheetSummary[] = tabs.map((tab) => ({
    name: tab.name,
    rowCount: tab.rows.length,
    columnCount: tab.headers.length,
  }));

  const tabPlans = useMemo(() => {
    return tabs.map((tab) => {
      if (tab.headers.length === 0) {
        return null;
      }
      return buildImport({
        headers: tab.headers,
        rows: tab.rows,
        choices: tab.choices,
        dateFormat: DATE_FORMAT,
        columns: target === "new" ? [] : columns,
        people,
      });
    });
  }, [tabs, columns, people, target]);

  const activePlan = tabPlans[activeTabIndex] ?? null;
  const planError = (() => {
    if (importAllTabs) {
      for (const plan of tabPlans) {
        if (plan && "error" in plan) {
          return plan.error;
        }
      }
      return "";
    }
    return activePlan && "error" in activePlan ? activePlan.error : "";
  })();

  const readyPlans: ImportPlan[] = importAllTabs
    ? tabPlans.filter((plan): plan is ImportPlan => plan != null && !("error" in plan))
    : activePlan && !("error" in activePlan)
      ? [activePlan]
      : [];

  const readyPlan: ImportPlan | null = activePlan && !("error" in activePlan) ? activePlan : null;

  function updateTab(index: number, patch: Partial<ImportTabState>) {
    setTabs((current) => current.map((tab, tabIndex) => (tabIndex === index ? { ...tab, ...patch } : tab)));
  }

  function remapTabs(nextTarget: "append" | "new", nextPeople = people) {
    setTabs((current) =>
      current.map((tab) => ({
        ...tab,
        choices: buildChoices(tab.headers, tab.rows, nextTarget, columns, nextPeople),
      })),
    );
  }

  async function onFile(file: File) {
    setError("");
    const loaded = await loadSpreadsheet(file);
    if ("error" in loaded) {
      setError(loaded.error);
      setTabs([]);
      setActiveTabIndex(0);
      workbookRef.current = null;
      return;
    }
    workbookRef.current = loaded;
    const names = loaded.sheetNames.length > 0 ? loaded.sheetNames : ["Sheet 1"];
    const nextTabs: ImportTabState[] = [];
    for (const name of names) {
      const parsed = loaded.read(name === "Sheet 1" && loaded.sheetNames.length === 0 ? undefined : name);
      if ("error" in parsed) {
        setError(parsed.error);
        setTabs([]);
        setActiveTabIndex(0);
        return;
      }
      nextTabs.push({
        name,
        headers: parsed.headers,
        rows: parsed.rows,
        choices: buildChoices(parsed.headers, parsed.rows, target, columns, people),
      });
    }
    setFileLabel(file.name);
    setTabs(nextTabs);
    setActiveTabIndex(0);
  }

  function onSheetChange(name: string) {
    const index = tabs.findIndex((tab) => tab.name === name);
    if (index >= 0) {
      setActiveTabIndex(index);
    }
  }

  async function onImport() {
    if (readyPlans.length === 0) {
      return;
    }
    if (target === "new" && !newName.trim()) {
      setError("Enter a sheet name.");
      return;
    }
    setPending(true);
    setError("");
    let imported = 0;
    let activeSheetId = sheetId;
    try {
      if (target === "new") {
        const prepared = tabs.flatMap((tab, index) => {
          const plan = tabPlans[index];
          if (!plan || "error" in plan) {
            return [];
          }
          const newColumns = plan.columns
            .filter((column) => column.source === "new")
            .map((column) => ({
              columnId: column.columnId,
              name: column.name,
              type: column.type,
              settings: column.settings,
            }));
          return [
            {
              name: tab.name || `Tab ${index + 1}`,
              newColumns,
              statusUpdates: plan.statusUpdates,
              rows: plan.rows,
              skippedCells: plan.emptyCells,
              unmatchedPeople: plan.unmatchedPeople,
            },
          ];
        });
        if (prepared.length === 0) {
          setError("Import at least one tab.");
          setProgress("");
          return;
        }
        setProgress(`Creating workbook with ${prepared.length} tab${prepared.length === 1 ? "" : "s"}`);
        const created = await importRows({
          mode: "new",
          workspaceId,
          sheetId: sheetId || undefined,
          name: newName.trim(),
          tabs: prepared.map((tab) => ({
            name: tab.name,
            newColumns: tab.newColumns,
            statusUpdates: tab.statusUpdates,
            rows: [],
            skippedCells: tab.skippedCells,
            unmatchedPeople: tab.unmatchedPeople,
          })),
          skippedCells: prepared.reduce((sum, tab) => sum + tab.skippedCells, 0),
          unmatchedPeople: [...new Set(prepared.flatMap((tab) => tab.unmatchedPeople))],
        });
        if (!created.ok) {
          setError(created.error || "Could not create the sheet.");
          setProgress("");
          return;
        }
        activeSheetId = created.sheetId ?? activeSheetId;
        const createdTabs =
          created.tabs ?? (created.sheetId ? [{ sheetId: created.sheetId, name: prepared[0]?.name ?? "Tab 1" }] : []);
        for (let tabIndex = 0; tabIndex < prepared.length; tabIndex += 1) {
          const tabRows = prepared[tabIndex]?.rows ?? [];
          const tabSheetId = createdTabs[tabIndex]?.sheetId;
          const tabName = createdTabs[tabIndex]?.name ?? prepared[tabIndex]?.name ?? "tab";
          if (!tabSheetId) {
            continue;
          }
          const totalChunks = Math.max(1, Math.ceil(tabRows.length / IMPORT_CHUNK_SIZE));
          for (let index = 0; index < tabRows.length; index += IMPORT_CHUNK_SIZE) {
            const chunk = tabRows.slice(index, index + IMPORT_CHUNK_SIZE);
            const chunkNumber = Math.floor(index / IMPORT_CHUNK_SIZE) + 1;
            setProgress(`Importing ${tabName} · chunk ${chunkNumber} of ${totalChunks}`);
            const result = await importRows({
              mode: "append",
              sheetId: tabSheetId,
              rows: chunk.map((data) => ({ rowId: crypto.randomUUID(), data })),
              skippedCells: 0,
              unmatchedPeople: [],
            });
            if (!result.ok) {
              const count = new Intl.NumberFormat("en-US").format(imported).replace(/,/g, " ");
              setError(
                `Imported ${count} rows. The remaining rows were not imported. Rows already imported were kept. ${result.error}`,
              );
              setProgress("");
              return;
            }
            imported += result.inserted;
          }
        }
      } else {
        const plan = readyPlans[0];
        if (!plan) {
          return;
        }
        const chunks: Array<Array<Record<string, JsonValue>>> = [];
        for (let index = 0; index < plan.rows.length; index += IMPORT_CHUNK_SIZE) {
          chunks.push(plan.rows.slice(index, index + IMPORT_CHUNK_SIZE));
        }
        if (chunks.length === 0) {
          chunks.push([]);
        }
        const newColumns = plan.columns
          .filter((column) => column.source === "new")
          .map((column) => ({
            columnId: column.columnId,
            name: column.name,
            type: column.type,
            settings: column.settings,
          }));
        for (let index = 0; index < chunks.length; index += 1) {
          setProgress(`Importing chunk ${index + 1} of ${chunks.length}`);
          const result = await importRows({
            mode: "append",
            sheetId: activeSheetId,
            newColumns: index === 0 ? newColumns : [],
            statusUpdates: index === 0 ? plan.statusUpdates : [],
            rows: (chunks[index] ?? []).map((data) => ({ rowId: crypto.randomUUID(), data })),
            skippedCells: plan.emptyCells,
            unmatchedPeople: plan.unmatchedPeople,
          });
          if (!result.ok) {
            const count = new Intl.NumberFormat("en-US").format(imported).replace(/,/g, " ");
            setError(`Imported ${count} rows. The remaining rows were not imported. Rows already imported were kept. ${result.error}`);
            setProgress("");
            return;
          }
          imported += result.inserted;
          if (result.sheetId) {
            activeSheetId = result.sheetId;
          }
        }
      }
    } catch (error) {
      const count = new Intl.NumberFormat("en-US").format(imported).replace(/,/g, " ");
      const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
      setError(`Imported ${count} rows. The remaining rows were not imported. Rows already imported were kept.${detail}`);
      setProgress("");
      return;
    } finally {
      setPending(false);
    }
    if (target === "new") {
      router.push(`/s/${activeSheetId}`);
    }
    onClose();
  }

  function chooseTarget(nextTarget: "append" | "new") {
    setTarget(nextTarget);
    remapTabs(nextTarget);
  }

  function chooseColumn(index: number, value: string) {
    if (!activeTab) {
      return;
    }
    const nextChoices = activeTab.choices.map((item, itemIndex) => {
      if (itemIndex !== index) {
        return item;
      }
      if (value === "skip") {
        return { ...item, kind: "skip" as const };
      }
      if (value === "new") {
        return { ...item, kind: "new" as const, columnId: item.kind === "new" ? item.columnId : crypto.randomUUID() };
      }
      const columnId = value.slice("existing:".length);
      const column = columns.find((candidate) => candidate.id === columnId);
      return { ...item, kind: "existing" as const, columnId, type: column?.type ?? item.type };
    });
    updateTab(activeTabIndex, { choices: nextChoices });
  }

  function chooseType(index: number, type: ColumnType) {
    if (!activeTab) {
      return;
    }
    updateTab(activeTabIndex, {
      choices: activeTab.choices.map((item, itemIndex) => (itemIndex === index ? { ...item, type } : item)),
    });
  }

  const hasFile = tabs.some((tab) => tab.headers.length > 0);

  return {
    error,
    setError,
    fileLabel,
    sheetNames,
    sheetSummaries,
    activeSheet: activeTab?.name ?? "",
    headers: activeTab?.headers ?? [],
    rows: activeTab?.rows ?? [],
    choices: activeTab?.choices ?? [],
    target,
    newName,
    setNewName,
    pending,
    progress,
    planError,
    readyPlan,
    readyPlans,
    importAllTabs,
    hasFile,
    onFile,
    onSheetChange,
    onImport,
    chooseTarget,
    chooseColumn,
    chooseType,
  };
}
