# T13: CSV import and export (migrate off Google Sheets)

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Goal
Bring the existing Google Sheets / Monday data in (File → Download → CSV), and get any sheet out as CSV that opens correctly in Excel with Arabic text.

## Allowed changes
`app/api/sheets/[sheetId]/export/route.ts` (new), `app/(app)/s/[sheetId]/_components/ImportDialog.tsx` (new), `app/(app)/sheets/import-actions.ts` (new), `lib/sheets/csv.ts` (new), `components/grid/Toolbar.tsx` (add Import/Export buttons only), `tests/unit/csv.test.ts`.

## Spec
1. **Export** (`csv.export`): `GET /api/sheets/:id/export?scope=all|view`.
   - `all`: every row in position order. `view`: the client sends the visible row ids (POST body; if that's simpler, use POST for both). The header row holds the column names, and values come from `displayValue` (person → names joined with ", ", status → label, link → URL, date → `YYYY-MM-DD`).
   - Response: `text/csv; charset=utf-8` **with a UTF-8 BOM** (`﻿`) so Excel shows the Arabic correctly. Filename `<sheet name>-<YYYY-MM-DD>.csv`, RFC 5987-encoded for Arabic names.
   - Escape formula injection: prefix cells starting with `= + - @` with `'`.
2. **Import** (`csv.import`), a 3-step dialog:
   1. **Upload** a `.csv` (max 5 MB / 10 000 rows), parsed client-side with `papaparse` (`header:true`, `skipEmptyLines:'greedy'`). Handle a BOM, and auto-detect delimiters (`,` `;` `\t`).
   2. **Map columns:** for each CSV header, choose an existing column (auto-matched by exact, then normalised name), **"New column" + type**, or **Skip**. Pick the date format (`YYYY-MM-DD`, `D/M/YYYY`, `M/D/YYYY`, `Month D, YYYY`, with a default guessed from the first 50 rows). Target: **this sheet (append)** or **a new sheet** (PM+, name it).
   3. **Preview:** the first 20 rows as they'll be stored, with invalid cells highlighted, plus a summary: "1 180 rows, 12 cells will be empty (invalid dates: 9, unknown people: 3)". Then **Import**.
3. **Value mapping** (`lib/sheets/csv.ts`, pure, tested):
   - status: unknown labels → **create new options** automatically (colours cycle through the palette) in one `column.update` before the rows.
   - person: split on `,` / `،` / newline, match by full name (case- and space-insensitive) or email. Leave unmatched names empty, but list them in the summary.
   - link: the URL, with the label empty.
   - Everything else goes through `normalizeValue`.
4. **Server action `importRows`:** chunks of 500 rows → `applyOp(user, rows.insertMany)` (the T07 engine, so it's logged, versioned and **broadcast live**: other users watch the rows appear). A new sheet is created via the T06 `createSheet` flow first. Return `{ inserted, skippedCells, unmatchedPeople[] }`. The UI shows progress (chunk i/n).
5. If a chunk fails, stop, report how many rows were imported, and don't roll back the earlier chunks (say so clearly in the UI).

## Acceptance criteria
- [ ] Export the Reports tracker with Arabic → it opens correctly in Excel (no mojibake) and in Google Sheets.
- [ ] Import the team's real Google Sheet CSV (the screenshot structure: 9 columns, Arabic, dates like "October 1, 2026", multi-editor cells) into a new sheet with correct types, status colours and people.
- [ ] A second browser sees the imported rows appear live.
- [ ] An employee can export but sees no Import button, and the server rejects their import.
- [ ] Formula-injection cells are escaped on export.

## Out of scope
XLSX, the Google Sheets API, scheduled sync.
