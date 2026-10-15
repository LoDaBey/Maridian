# T09: Grid UI and column types

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Goal
Replace the DebugTable with a fast, keyboard-driven, Google-Sheets-feel grid with Monday-style typed cells, built on the T08 store. It must stay smooth at **5 000 rows × 12 columns**, in both RTL and LTR.

## Allowed changes
`components/grid/*` (Grid, HeaderCell, RowGutter, Cell, editors/*, renderers/*, useGridKeyboard, useSelection, clipboard.ts, undo.ts), `app/(app)/s/[sheetId]/_components/SheetClient.tsx`, delete `DebugTable.tsx`, `app/api/users/directory/route.ts` (new), `stores/sheet-store.ts` (only selection/undo slices if you keep them there), `tests/unit/clipboard.test.ts`.

## Spec
1. **Layout:** `@tanstack/react-table` for the column model, `@tanstack/react-virtual` for **rows** (fixed row height 36px, overscan 12). The grid container sets `dir={sheet.direction}` and uses **logical CSS only** (`ps-/pe-`, `start/end`, `border-s`) so RTL mirrors correctly. Sticky header row (36px) and a sticky row-number gutter (48px, on the inline-start side). Column widths come from `column.width`. Horizontal scroll inside the grid only.
2. **Cells:** a memoised component subscribed via `useCell(rowId,colId)`. Overflowing text ends in an ellipsis, and the full value shows on hover (`title`).
3. **Selection model:** active cell + optional range (anchor/focus). Click selects; Shift+click / Shift+arrows extend; a header click selects the column; a gutter click selects the row (Shift for ranges). The active cell gets a 2px `--primary` border, and the range a translucent fill.
4. **Keyboard** (`useGridKeyboard`). In RTL, ArrowLeft/ArrowRight are **visually** correct (ArrowLeft moves toward the visual left):
   - Arrows move. Tab / Shift+Tab move along the row. Enter starts editing; while editing, Enter commits and moves down. Escape cancels the edit (no op sent). F2 edits while keeping the content.
   - Typing a printable character on a selected cell starts editing with that character (replaces the content).
   - Delete/Backspace clears all selected cells → one `cells.setMany`.
   - Ctrl/Cmd+C copies the range as **TSV** (display values). Ctrl/Cmd+V pastes TSV/plain text from Google Sheets or Excel starting at the active cell: values go through `normalizeValue` client-side, invalid ones are skipped and counted in a toast, it's one `cells.setMany`, and if the paste runs past the last row, `rows.insertMany` comes first. Write `clipboard.ts` (`parseTSV`, `toTSV`) with unit tests (quotes, tabs, newlines inside quoted cells, Arabic).
   - Ctrl/Cmd+Z / Ctrl+Y (Cmd+Shift+Z): **undo/redo of my own ops only**, using the inverse ops from T08 (stack of 100, cleared on sheet switch). Undo dispatches the inverse as a new op.
5. **Editors and renderers per type.** Every editor commits via `dispatch` **only on commit** (Enter, Tab, blur, or a pick):
   | type | renderer | editor |
   |---|---|---|
   | text | plain text | inline input |
   | long_text | first line + ellipsis | popover textarea (min 240×140). Enter commits, Shift+Enter adds a newline. |
   | link | label or hostname+path, blue, with an ↗ icon. Ctrl/Cmd+click or the icon opens in a new tab with `rel="noopener noreferrer"`. | popover: URL + optional label |
   | date | `Oct 1, 2026` (locale `en-US`) | popover `<input type="date">`. Picking commits. "Today" button and "Clear". |
   | person | avatar chips (initials on colour) + names, "+N" overflow | searchable popover multi-select of active users (from `GET /api/users/directory`). Toggling commits immediately. |
   | status | **Monday-style full-cell coloured pill** with white label text, centered | popover list of options (colour swatch + label). A click commits. "Clear". |
   | number | aligned to the end, `Intl.NumberFormat` | inline input, parsed on commit, invalid input → shake + no commit |
   | checkbox | centered checkbox | a click or Space toggles and commits immediately (no editor) |
6. **`GET /api/users/directory`:** requires a user and returns active users `{ id, fullName, avatarColor }`, cached in a client module for the session.
7. **Add row:** a sticky "+ Add row" line under the last row → `row.insert` at the end (position after the last row), then focus its first cell.
8. **Column resize:** a drag handle on the header edge (if `can(role,'column.resize')`). Show the live width while dragging, and dispatch `column.resize` **once on mouseup**.
9. **Read-only:** if the sheet is archived or the user lacks `cell.edit`, editors don't open, and a subtle banner explains why.
10. **Look:** Monday/Sheets hybrid. Header `bg-gray-50`, font-medium 13px, with a type icon (lucide) before the name. Cell text 13px, IBM Plex Sans Arabic for Arabic. 1px grid lines `--border`. Hovered row `bg-gray-50/60`. The status pill fills the cell with a 2px inset.
11. **Performance:** no whole-grid re-render on a single cell change (verify with the React DevTools profiler). Scrolling 5 000 rows stays smooth. Write `scripts/seed-big-sheet.ts` (allowed), which inserts 5 000 rows into a sheet via `applyOp` for testing.

## Acceptance criteria
- [ ] All 8 types render and edit correctly in RTL **and** LTR sheets.
- [ ] A keyboard-only flow works: navigate, edit, commit, Tab across, Escape cancels.
- [ ] Copying 10×5 from Google Sheets and pasting works and syncs to a second browser as one op.
- [ ] Undo/redo of my own edits works and syncs.
- [ ] 5 000 rows: scrolling is smooth, and editing one cell re-renders only that cell (paste a profiler screenshot in the hand-off).
- [ ] No ops are sent while typing, only on commit.

## Out of scope
Presence overlays (T10), column/row menus (T11), filter/sort (T12).
