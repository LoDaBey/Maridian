# T08: Client sync layer and autosave

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Goal
A client-side store per open sheet that loads the snapshot, applies local edits **optimistically**, sends them as ops, applies everyone else's ops live, survives disconnects without losing edits, and shows a save status. T09 builds the real grid on top of this, so this ticket proves it with a **plain debug table**.

## Allowed changes
`stores/sheet-store.ts`, `lib/sheets/apply-local.ts` (pure: apply an op to client state + compute its inverse), `lib/realtime/sheet-session.ts`, `app/(app)/s/[sheetId]/page.tsx`, `app/(app)/s/[sheetId]/_components/SheetClient.tsx`, `app/(app)/s/[sheetId]/_components/DebugTable.tsx`, `app/(app)/_components/SaveStatus.tsx`, `tests/unit/apply-local.test.ts`.

## Spec
1. **State** (`zustand`, created per sheet session):
   ```
   sheet {id,name,direction}, version
   columns: Record<id, Column>, columnOrder: id[]   (sorted by position)
   rows: Record<id, Row>,       rowOrder: id[]      (sorted by position)
   pending: Map<clientOpId, { op, inverse, sentAt, attempts }>   // ordered
   status: 'connecting' | 'saved' | 'saving' | 'offline' | 'error'
   lastSavedAt?: number, lastError?: string
   ```
   Expose fine-grained selectors: `useCell(rowId, colId)`, `useRowIds()`, `useColumn(id)`, `useColumns()`. A cell must re-render **only** when its own value changes.
2. **`apply-local.ts`**: `applyOpToState(state, op) → { state, inverse }` for every op type in `lib/sheets/ops.ts`. Keep `rowOrder`/`columnOrder` sorted by position using binary insert. Unit test every op plus its inverse round-trip.
3. **`sheet-session.ts`**: `openSheet(sheetId)`:
   - Emit `sheet:join` → load the snapshot into the store → `status='saved'`.
   - `dispatch(type, payload)`: build the op with a new `clientOpId`, apply it locally, push it to `pending`, and **emit if connected** (otherwise just keep it queued).
     - ack ok → remove from `pending` and advance `version`.
     - ack error → apply the inverse (rollback), set `lastError`, show a toast with the message ("You don't have permission…", "This sheet is read-only", etc.). `rate_limited` → retry after 500ms instead.
     - no ack within 10s → mark `error`, keep it in pending, and retry on the next reconnect.
   - `op:applied` from others: if `version !== state.version + 1`, buffer it and wait 1.5s for the gap to fill, otherwise **resync**. Applying a remote `cell.set` to a cell that has a **pending local op** updates that pending op's inverse (so a rollback goes back to the latest server value) but **keeps showing the local value**.
   - `sheet:meta` → update name/direction (archived → read-only banner and disable editing).
   - **Reconnect / resync:** on `connect` after a disconnect, re-join → new snapshot → re-apply all pending ops locally on top of it, in order → resend them (the server dedupes by `clientOpId`).
   - `closeSheet()` on navigation: emit `sheet:leave` and drop the store (keep pending ops flushing in the background until acked).
   - Gate `beforeunload` with a confirm while `pending.size > 0`.
4. **Autosave contract (the grid in T09 must follow it):** the grid calls `dispatch` **only when a cell editor commits**, never on keystrokes. There's no Save button anywhere.
5. **`SaveStatus`** (rendered into the `#save-status-slot` from T06 via a portal, or by lifting state; pick the simplest): "Saving…" (spinner) while pending > 0, "All changes saved" with a check (tooltip: time), "Offline. N changes will sync when you reconnect" (amber), "Couldn't save. Retrying…" (red).
6. **DebugTable:** a plain `<table>` rendering columns × rows with `dir` from the sheet, where each cell is an `<input>` that dispatches `cell.set` on blur/Enter, plus an "Add row" button (`row.insert` at the end). It's temporary, and T09 replaces it.

## Acceptance criteria
- [ ] Two browsers on the same sheet: an edit in A appears in B in under 500ms on localhost, with no reload.
- [ ] Kill the network in A (DevTools offline), edit 3 cells → the status says Offline with 3 changes. Reconnect → they're saved and B sees them. Nothing is lost or duplicated.
- [ ] Edits rejected by the server (e.g. an employee forging a `column.delete` from the console) roll back visibly with a toast.
- [ ] Concurrent edits to the same cell converge to the same value in both browsers.
- [ ] Typing in a cell sends **no** ops until blur/Enter (check the WS frames in DevTools).
- [ ] Leaving the page with pending ops shows the browser's confirm.
- [ ] `apply-local` unit tests pass.

## Out of scope
The real grid UI, presence, undo/redo (T09).
