import type { SpreadsheetTable } from "@/lib/db-types";
import { CSV_MAX_BYTES, parseCsv, tableFromRows } from "@/lib/sheets/csv";

const EXCEL_NAME = /\.(xlsx|xlsm|xls)$/i;
const EXCEL_TYPES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
]);

export interface SpreadsheetWorkbook {
  fileName: string;
  sheetNames: string[];
  read(sheetName?: string): SpreadsheetTable | { error: string };
}

export async function loadSpreadsheet(file: File): Promise<SpreadsheetWorkbook | { error: string }> {
  if (file.size > CSV_MAX_BYTES) {
    return { error: "Files must be 5 MB or smaller." };
  }
  if (isCsv(file)) {
    const parsed = parseCsv(await file.text());
    if ("error" in parsed) {
      return parsed;
    }
    return {
      fileName: file.name,
      sheetNames: [],
      read: () => parsed,
    };
  }
  if (!isExcel(file)) {
    return { error: "Use an Excel workbook (.xlsx) or a CSV file." };
  }
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const sheetNames = workbook.SheetNames.filter((name) => name.trim().length > 0);
  if (sheetNames.length === 0) {
    return { error: "The workbook has no sheets." };
  }
  return {
    fileName: file.name,
    sheetNames,
    read(sheetName) {
      const name = sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0];
      if (!name) {
        return { error: "The workbook has no sheets." };
      }
      const sheet = workbook.Sheets[name];
      if (!sheet) {
        return { error: "That sheet could not be read." };
      }
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: false,
        defval: "",
        blankrows: false,
      });
      return tableFromRows(matrix.map((row) => (Array.isArray(row) ? row.map(cellText) : [])));
    },
  };
}

function isCsv(file: File): boolean {
  return file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv" || file.type === "application/csv";
}

function isExcel(file: File): boolean {
  return EXCEL_NAME.test(file.name) || EXCEL_TYPES.has(file.type);
}

function cellText(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${month}-${day}`;
  }
  return String(value);
}
