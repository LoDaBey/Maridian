# T07: Sheet engine (server-authoritative ops over Socket.IO)

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Goal
The heart of realtime sync. One function, `applyOp`, validates, authorises, persists and versions every change to a sheet's rows and columns. The socket layer delivers a snapshot on join, applies ops with acks, and broadcasts them to everyone in the sheet. **There's no UI in this ticket.**

## Allowed changes
`lib/sheets/ops.ts`, `lib/sheets/values.ts`, `lib/sheets/apply-op.ts`, `lib/sheets/snapshot.ts`, `lib/realtime/sheet-handlers.ts`, `lib/realtime/socket-server.ts` (register handlers only), `tests/unit/values.test.ts`, `tests/unit/apply-op.test.ts` (may hit a test DB via `DATABASE_URL_TEST`. Skip it if unset and say so), `scripts/dev-two-clients.ts`, `app/(app)/sheets/actions.ts` (only to add the `sheet:meta` emit calls).

## Spec

### 1. `lib/sheets/ops.ts`: shared client/server, zod schemas + TS types
Every op is `{ clientOpId: string(uuid), sheetId: uuid, type, payload }`.
| type | payload | permission |
|---|---|---|
| `cell.set` | `{ rowId, columnId, value: unknown \| null }` (null = clear) | cell.edit |
| `cells.setMany` | `{ cells: [{rowId, columnId, value}] }` max 5 000 | cell.edit |
| `row.insert` | `{ rowId, position, data? }` | row.insert |
| `rows.insertMany` | `{ rows: [{rowId, position, data?}] }` max 1 000 | row.insert |
| `row.delete` | `{ rowIds: uuid[] }` max 1 000 (soft delete) | canDeleteRow per row |
| `row.restore` | `{ rowIds: uuid[] }` | same as delete |
| `row.move` | `{ rowId, position }` | row.move |
| `column.insert` | `{ columnId, name, type, position, width?, settings? }` | column.manage |
| `column.update` | `{ columnId, patch: { name?, type?, settings? } }` | column.manage |
| `column.resize` | `{ columnId, width }` | column.resize |
| `column.delete` / `column.restore` | `{ columnId }` (soft) | column.manage |
| `column.move` | `{ columnId, position }` | column.manage |

### 2. `lib/sheets/values.ts`: pure functions, unit tested
- `normalizeValue(column, raw)` → `{ ok: true, value: Json \| undefined }` (undefined = clear the key) or `{ ok:false, error }`, using the shape table in `db/README.md` (T02). Trim strings, turn empty strings into clear, require `http(s)` for links (auto-prefix `https://` when there's no scheme), require a valid calendar `YYYY-MM-DD` for dates, require person ids to be unique, and require status ids to exist in `column.settings.options`.
- `convertValue(value, fromType, toType, toSettings)` for type changes: anything → text uses `displayValue`. text → number parses. text → date parses ISO, `D/M/YYYY` and `Month D, YYYY`. text → status matches an option label exactly (case-insensitive). text → link applies the URL rule. Anything unconvertible → cleared. Report the count of cleared cells.
- `displayValue(column, value, usersById)` → string (used by CSV export, search and history).
- Settings schemas: `status: { options: [{ id, label (1..50), color (#hex) }] (max 50) }`, `person: { multiple: boolean }`, others `{}`.

### 3. `lib/sheets/apply-op.ts`: `applyOp(user, op) → { ok: true, version, op: NormalizedOp } | { ok: false, code, message }`
Inside **one `tx()`**:
1. `SELECT … FROM monitor_sheets WHERE id=$1 FOR UPDATE`. Missing → `not_found`. Archived → `read_only`.
2. Check the permission per the table (load `created_by` for row deletes).
3. Validate the targets exist in **this** sheet and aren't deleted (column for `cell.set`, row for `cell.set`, etc.). Validate values with `normalizeValue`.
4. Write:
   - cell: `UPDATE monitor_rows SET data = CASE WHEN $v IS NULL THEN data - $col ELSE jsonb_set(data, ARRAY[$col], $v) END, updated_by=$u WHERE id=$row AND sheet_id=$s RETURNING data->$col` (read the old value first, for the log). **Only the one key changes**, so concurrent edits to other cells of the row are preserved.
   - `cells.setMany`: one statement per row (group cells by row) or a `jsonb` merge. Keep it in the same tx.
   - `column.update` with a type change: run `convertValue` over all rows' values for that column in the same tx.
   - status options removed in `column.update` → clear the cells that used them.
   - `row.insert` with a duplicate `rowId` that already exists in this sheet with the same data → treat it as idempotent success.
5. `UPDATE monitor_sheets SET version = version + 1 RETURNING version`.
6. Insert `monitor_activity_log` rows (one per changed cell, with old and new value; `cells.setMany`/`rows.insertMany` batch-insert via `unnest`, capped at 2 000 detail rows plus one summary row).
7. Return the **normalized** op (server values, not raw input).

**Idempotency:** keep an in-memory LRU (10 000 entries, 10-minute TTL) of `clientOpId → result`. A repeated `clientOpId` returns the cached result without re-applying it (clients resend after reconnects).

### 4. `lib/sheets/snapshot.ts`: `loadSnapshot(sheetId)`
`{ sheet: {id,name,direction,version}, columns: Column[] (ordered, not deleted), rows: {id, position, data, createdBy, updatedAt}[] (ordered, not deleted) }`, read in **one REPEATABLE READ transaction** so `version` matches the data exactly. If there are more than 20 000 rows, still return them but log a warning.

### 5. `lib/realtime/sheet-handlers.ts`: socket events (all payloads zod-validated, every handler wrapped in try/catch → error ack)
- `sheet:join` `{ sheetId }` → check `sheet.view`, leave any previously joined `sheet:*` room, join `sheet:<id>`, ack `{ ok, snapshot }`.
- `sheet:leave` `{ sheetId }`.
- `op` `(op, ack)` → `applyOp(socket.data.user, op)` → ack the result. On success, `socket.to('sheet:'+id).emit('op:applied', { op, version, userId, clientOpId, at })`. Other tabs of the same user receive it too, because `socket.to` only excludes **this** socket.
- **Rate limit:** max 30 ops/sec per socket (token bucket). Over the limit → ack `{ ok:false, code:'rate_limited' }`.
- Use `socket.data.user` (kept fresh by T05's `refreshUserSockets`) for permissions.
- Sheet rename/direction/archive from T06 actions: also emit `sheet:meta` `{ id, name, direction, archived }` to `sheet:<id>` (add a helper and call it from the T06 actions; list that file in the hand-off).

## Acceptance criteria
- [ ] Unit tests for `normalizeValue` / `convertValue` cover every type, including Arabic text, empty values and invalid input.
- [ ] Two scripted socket clients (write `scripts/dev-two-clients.ts`, allowed) setting **different cells of the same row** at the same time → both values persist.
- [ ] The same cell set concurrently → the final DB value equals the op with the **higher version**, and both clients converge to it.
- [ ] Every successful op bumps `version` by exactly 1, and the versions a client receives are contiguous.
- [ ] An employee sending `column.insert` or deleting someone else's row gets `forbidden`, and the DB is unchanged.
- [ ] A replayed `clientOpId` doesn't double-apply.
- [ ] A changed column type converts existing values, and the hand-off reports the cleared count.
- [ ] Ops on an archived sheet are rejected with `read_only`.

## Out of scope
Client store, UI, presence (T10).
