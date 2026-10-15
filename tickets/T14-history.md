# T14: Activity history (sheet feed + cell history + restore)

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Goal
Managers can see who changed what and when, and anyone who can edit can restore an older cell value. This replaces Google Sheets' version history for day-to-day needs.

## Allowed changes
`app/api/sheets/[sheetId]/activity/route.ts` (new), `app/api/sheets/[sheetId]/cells/[rowId]/[columnId]/history/route.ts` (new), `components/history/ActivityDrawer.tsx` (new), `components/history/CellHistoryPopover.tsx` (new), `components/grid/Toolbar.tsx` (add a History button only), `components/grid/RowContextMenu.tsx` (add a "Cell history" item only), `lib/sheets/activity-repo.ts` (new).

## Spec
1. **Sheet activity feed** (`history.view` = TL+): `GET /api/sheets/:id/activity?before=<id>&limit=50&userId=` → keyset paginated by `id DESC`. Join the user name. Return the column name (including deleted columns) and the old/new values rendered with `displayValue`.
   - A drawer on the end side (RTL-aware), with infinite scroll and a filter by user. Each entry has an avatar, "**Amal Mahmoud** changed **الحالة** on row 12 from *جاري العمل عليه* → *تم*", a relative time (tooltip with the absolute time) and **Go to cell** (scrolls and flashes; if the row was deleted, show "row deleted").
   - Group consecutive entries from the same user within 60s ("Amal edited 6 cells").
   - Bulk entries (paste/import summaries) read "Imported 500 rows" / "Pasted 40 cells".
   - New activity arrives live: subscribe to the existing `op:applied` (don't add new socket events) and prepend a lightweight "N new changes, refresh" pill.
2. **Cell history** (anyone with `sheet.view`, so employees can see what happened to a cell they work on): right-click a cell → "Cell history" → a popover with that cell's entries (last 50) and **Restore** on each old value (requires `cell.edit`) → `dispatch('cell.set', …)` via T08, so it's live and logged like any edit.
3. **Indexes:** the T02 indexes cover `(sheet_id, id desc)` and `(row_id, id desc)`. Cell history filters `row_id` and then `column_id`. If EXPLAIN shows a seq scan on a large log, **say so in the hand-off and propose an index. Don't change the schema yourself.**
4. **Security:** the activity route checks the permission **and** that the sheet exists. Never return `user.*` audit rows (sheet_id NULL) here.

## Acceptance criteria
- [ ] An employee can't open the sheet activity drawer (the button is hidden and the API returns 403) but can see cell history.
- [ ] Restoring an old value updates every connected browser and creates a new log entry.
- [ ] Pagination works over 1 000+ entries without duplicates or gaps.
- [ ] Entries for deleted columns or rows still render readable names.

## Out of scope
Full-sheet point-in-time restore, admin audit UI for user actions.
