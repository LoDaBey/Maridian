# F02: Paste must understand labels, names and display dates

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Problem (found in review)
`components/grid/Grid.tsx` (paste handler, around line 459) passes raw clipboard text to `normalizeValue`. That function expects **stored** shapes: status option **ids**, person **user ids**, dates as `YYYY-MM-DD`. So:
- Pasting the team's Google Sheet into the Reports tracker skips every status cell (`تم`, `يومي`…) and every editor name. Those are the columns that matter most.
- Copying a status, person or date cell **inside the app** and pasting it elsewhere also fails, because copy writes the display text (`تم`, `Amal Mahmoud`, `Oct 1, 2026`).

## Goal
Pasted text is converted to the target column's type the same way the CSV import (T13) does it.

## Allowed changes
`components/grid/Grid.tsx` (paste handler only), `lib/sheets/paste.ts` (new, pure), `lib/sheets/csv.ts` (only to export the existing person/status/date matching helpers if they're private; don't change their behaviour).

## Spec
1. `lib/sheets/paste.ts`: `textToCellValue(column, text, usersById)` → `{ ok: true, value } | { ok: false }`, and **reuse** the T13 helpers (don't write a second copy):
   - **status:** match an option **label** (case- and space-insensitive). Also accept an option id. No match → `ok:false`. **Don't create new options on paste.**
   - **person:** split on `,` / `،` / newline, match full name or email from the directory, and drop unknown names. If none match → `ok:false`.
   - **date:** accept `YYYY-MM-DD`, `Month D, YYYY` (e.g. `Oct 1, 2026` / `October 1, 2026`), and `D/M/YYYY`.
   - **checkbox:** `true/false`, `yes/no`, `1/0`, `✓`, `TRUE/FALSE` (Google Sheets).
   - **number:** strip thousands separators (`1,250`).
   - **link, text, long_text:** same as today.
   - Then run the result through `normalizeValue` as the final check.
2. The paste handler calls `textToCellValue` instead of `normalizeValue`. The "Skipped N invalid values" toast stays.
3. Undo grouping: when a paste needs `rows.insertMany` **and** `cells.setMany`, one Ctrl+Z must undo both (record them as one undo entry).

## Acceptance criteria (manual)
- [ ] Copy 10 rows × all 9 columns from the real Google Sheet and paste them into a Reports tracker sheet. Status pills, editor chips, dates and links all fill in, and a second browser sees them.
- [ ] Copy a status cell, a person cell and a date cell inside the app and paste them into another row. The values match.
- [ ] A label that doesn't exist (e.g. `foo` into الحالة) is skipped and counted in the toast.
- [ ] A paste that adds rows is undone with **one** Ctrl+Z.
