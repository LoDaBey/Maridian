# T10: Live presence (who's online, and which row/column/cell they're on)

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Goal
Like Google Sheets: see who's inside the current sheet, exactly which cell each person is on, whether they're typing, and which rows/columns are being worked on. The tab bar also shows how many people are in each sheet.

## Allowed changes
`lib/realtime/presence.ts` (new, server registry), `lib/realtime/sheet-handlers.ts` (presence events + join ack extension), `lib/realtime/socket-server.ts` (disconnect hook only), `stores/presence-store.ts` (new), `components/presence/*` (AvatarStack, CellPresenceOverlay, PresenceDot), `components/grid/*` (only to render the overlays/header and gutter highlights and to emit the local selection), `app/(app)/_components/SheetTabs.tsx` (per-tab counts only), `app/(app)/s/[sheetId]/_components/SheetClient.tsx`.

## Spec
1. **Server registry** (`presence.ts`, in memory): `Map<sheetId, Map<socketId, Presence>>`, where
   `Presence = { userId, fullName, avatarColor, role, activeCell: {rowId, columnId} | null, selection?: {startRow, endRow, startCol, endCol ids} | null, editing: boolean, idle: boolean, updatedAt }`.
   - On `sheet:join`: add an entry (activeCell null). **Extend the join ack** with `presence: Presence[]` (other sockets).
   - Client → `presence:update` `{ sheetId, activeCell, selection, editing, idle }`: validate it with zod, make sure the socket is in that room, store it, and broadcast `presence:update` `{ socketId, ...presence }` to the room except the sender. **Server throttle:** at most 15 updates/sec per socket (drop the extras, keep the latest).
   - On `sheet:leave`, disconnect, or joining another sheet: remove the entry and broadcast `presence:leave` `{ socketId }`.
   - **Workspace counts:** whenever a sheet's membership changes, emit `workspace:presence` `{ sheetId, users: [{userId, fullName, avatarColor}] (deduped by user) }` to room `workspace` (debounced 300ms per sheet). Send the full map to a socket when it connects.
2. **Client** (`presence-store.ts`, zustand): keyed by socketId. Selectors by cell (`usePresenceAt(rowId,colId)`), by row, and by column, so only the affected cells re-render.
   - Emit my presence when the active cell, selection or editing state changes (throttled to 10/s, leading + trailing).
   - **Idle:** no mouse/keyboard activity for 5 min → `idle:true`.
   - On reconnect, re-send my current presence after the re-join.
3. **UI:**
   - **AvatarStack** in the top bar `#presence-slot`: the people in this sheet, deduped by user (several tabs = one avatar), **including me** last with "(you)". Up to 5 avatars + "+N". Idle users are dimmed. The tooltip shows name, role and location, e.g. "Row 12 · الحالة", or "typing…" when editing. **Clicking an avatar scrolls the grid to their active cell and flashes it** (follow).
   - **Cell overlay:** another user's active cell gets a 2px border in **their** colour plus a small name tag above the cell (the start corner; in RTL it mirrors). If they're editing, the tag reads "{name} · typing…" with a subtle pulse. Their selection range gets a 8% fill of their colour. When several users share a cell, stack the tags.
   - **Row and column hints:** the row gutter and column header show small coloured dots (max 3 + "+") for the users on that row/column.
   - **Soft edit lock:** if I open the editor on a cell someone else is `editing`, show an inline warning "Amal Mahmoud is editing this cell". Editing is still allowed (last write wins).
   - **Tab bar:** each sheet tab shows up to 3 tiny avatars (or a count) of the users currently in it, from `workspace:presence`.
4. Overlays must not intercept pointer events (`pointer-events:none`), and they must stay in sync while scrolling virtualised rows (render them inside the cell/row component, not as absolute layers computed from the DOM).

## Acceptance criteria
- [ ] 3 browsers (3 different users) in one sheet: each sees the other two in the avatar stack, with live cursors and correct colours, within about 200ms of moving.
- [ ] Typing state shows on the cell for others, and disappears on commit or cancel.
- [ ] Closing a tab removes that user's cursor for others within 2s. Two tabs of the same user show one avatar.
- [ ] Clicking an avatar scrolls to and flashes their cell, even if it's 3 000 rows away.
- [ ] The tab bar shows who is in each sheet live.
- [ ] RTL sheets mirror the tags and dots correctly.
- [ ] Moving the cursor around produces no more than about 10 presence msgs/sec per user (check WS frames).

## Out of scope
Chat, comments, follow mode beyond a single jump.
