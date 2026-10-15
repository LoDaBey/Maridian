# F03: Know who "me" is in the sheet, plus small cleanups

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Problems (found in review)
1. The sheet page never receives the signed-in user's **id**. T11 and T12 worked around it by reading the presence entry marked "you", so until presence arrives (and whenever the socket is reconnecting) **"My rows" matches nothing**, and the employee's **Delete row** permission is computed wrong.
2. `lib/sheets/apply-local.ts:159` creates new rows with `createdBy: null`. The T11 grid patched over it with a remembered-ids list that's lost on reload and doesn't cover other tabs.
3. `lib/auth/session.ts:69` `cleanupExpiredSessions()` calls `Date.now()` during page render, which raises the Cache Components prerender error noted in the T05/T06 hand-offs.
4. `app/(app)/admin/users/_components/session-events.tsx` is unused (RealtimeProvider replaced it).
5. `lib/realtime/sheet-session.ts:116` exposes `window.__monitorDispatch` in **production**. The server still checks permissions, but a debug hook shouldn't ship to the client.

## Allowed changes
`app/(app)/s/[sheetId]/page.tsx`, `app/(app)/s/[sheetId]/_components/SheetClient.tsx`, `components/grid/*` (only to replace the presence-"you" workaround and the remembered-ids list), `lib/sheets/apply-local.ts`, `lib/realtime/sheet-session.ts`, `app/api/users/directory/route.ts`, `lib/auth/session.ts`, `server.ts` (cleanup timer only), delete `app/(app)/admin/users/_components/session-events.tsx`.

## Spec
1. **`page.tsx`** already has the user (via `requireUser()`). Pass `me = { id, role }` as props to `SheetClient`, and provide it through a small React context (`useMe()`) in `components/grid/`.
2. Replace every "presence you" / remembered-ids workaround in the grid with `useMe()`: `canDeleteRow(me, row)`, "My rows", and the employee's own-row delete.
3. `apply-local.ts`: `row.insert` / `rows.insertMany` set `createdBy` to the current user id. Pass it in through `openSheet(sheetId, { userId })` from `sheet-session.ts`. The server value from the snapshot still wins on resync.
4. `directory/route.ts`: remove the extra `role` field (no longer needed). The response is just `{ users }`.
5. `session.ts`: remove the call to `cleanupExpiredSessions()` from the request path and export it. In `server.ts`, run it once at startup and then every hour (`setInterval(...).unref()`).
6. Only expose `window.__monitorDispatch` when `process.env.NODE_ENV !== 'production'`.
7. Delete `session-events.tsx`.

## Acceptance criteria (manual)
- [ ] An employee adds a row, reloads, and can still delete it. They can't delete the PM's row (menu disabled), even right after opening the sheet.
- [ ] "My rows" works immediately on page load, before any presence arrives.
- [ ] Opening authenticated pages in dev no longer logs the `Date.now()` prerender error.
- [ ] In `npm run build && npm start`, `window.__monitorDispatch` is `undefined`.
- [ ] `npx tsc --noEmit`, `npm run lint` and `npm run build` pass.
