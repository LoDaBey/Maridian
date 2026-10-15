# T12: Find, filter, sort (personal view)

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Goal
With hundreds of report rows a day, people need to find "my rows today" fast. Filters and sort are **personal** (they don't change the shared sheet or other users' views), and they're remembered per sheet in this browser.

## Allowed changes
`components/grid/Toolbar.tsx` (new), `components/grid/FilterBuilder.tsx` (new), `components/grid/useViewState.ts` (new; replaces the T11 stub), `components/grid/Grid.tsx` (use the derived row order), `lib/sheets/view.ts` (new: pure filter/sort/search functions), `tests/unit/view.test.ts`.

## Spec
1. **Toolbar** above the grid (40px): a search input (Ctrl/Cmd+F focuses it, Escape clears), a **Filter** button with an active-count badge, a **Sort** button, a quick toggle **"My rows"** (person column contains me *or* `created_by = me`; pick the first person column, and fall back to `created_by`), and a quick **"Today"** (the first date column = today). On the end side: "Showing 34 of 1 204 rows · Clear all" when anything is active.
2. **`lib/sheets/view.ts`**: `deriveRowOrder(rows, rowOrder, columns, view, me, usersById) → rowId[]`. Pure and unit tested.
   - **Search:** case-insensitive, diacritics-insensitive (also normalise Arabic: strip tashkeel, unify أ/إ/آ → ا, ة→ه, ى→ي) match over the `displayValue` of all cells. Matching text is highlighted in cells.
   - **Filters** (AND between rules):
     | type | operators |
     |---|---|
     | text, long_text, link | contains, does not contain, is empty, is not empty |
     | status | is any of [options], is none of, is empty |
     | person | includes any of [users or "me"], is empty |
     | date | is today, yesterday, this week, last 7 days, this month, between [from,to], is empty |
     | number | =, ≠, >, <, between, is empty |
     | checkbox | is checked / unchecked |
   - **Sort:** a single column, asc/desc, using a type-aware comparator. Status sorts by option order, empty values go last, and ties keep the original position.
3. **`useViewState(sheetId)`**: `{ search, filters, sort, isTransformed }`, persisted in `localStorage` key `monitor:view:<sheetId>` (wrapped in try/catch).
4. **Live behaviour:** remote edits re-derive the order (memoised and keyed on the store's version, so it doesn't recompute per keystroke). **A row I just created or edited stays visible** until the view changes, even if it no longer matches. Pin it and show a subtle "Doesn't match filter" marker.
5. While `isTransformed`: row drag-reorder is disabled (tooltip "Clear sort/filter to reorder"), and "Insert above/below" still inserts relative to real positions.
6. Presence: "follow" (T10) on a hidden row shows a toast "Row hidden by your filter. Clear filters?" with an action button.

## Acceptance criteria
- [ ] A filter in browser A doesn't affect browser B.
- [ ] The filter survives a reload of the same sheet, and each sheet keeps its own view.
- [ ] Arabic search matches across hamza/taa-marbuta variants (unit tests).
- [ ] "My rows" + "Today" give the expected subset on the Reports tracker template.
- [ ] 5 000 rows: applying a filter takes under 100ms (log `performance.now()` in dev and paste it).

## Out of scope
Shared/saved views, group-by, multi-column sort.
