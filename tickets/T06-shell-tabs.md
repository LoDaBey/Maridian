# T06: App shell and sheet tabs

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Goal
The authenticated layout: a top bar, the sheet area, and a **Google-Sheets-style tab bar at the bottom** where users switch between unlimited sheets. Sheet-level actions (create, rename, duplicate, reorder, direction, archive/restore) work and update every connected user's tab bar live.

## Before coding, read
`docs/01-app/01-getting-started/03-layouts-and-pages.md`, `04-linking-and-navigating.md`, `07-mutating-data.md`, `docs/01-app/02-guides/server-actions.md`.

## Allowed changes
`app/(app)/layout.tsx`, `app/(app)/page.tsx`, `app/(app)/s/[sheetId]/page.tsx` (new: placeholder body for now), `app/(app)/_components/*` (TopBar, UserMenu, SheetTabs, TabMenu, ArchivedSheetsDialog, EmptyState), `app/(app)/sheets/actions.ts`, `lib/sheets/sheets-repo.ts` (new), `lib/sheets/templates.ts` (new), `lib/realtime/socket-server.ts` (workspace room join + `broadcastSheetsChanged()` only), `lib/realtime/client.ts` (new: singleton socket client), `app/(app)/_components/RealtimeProvider.tsx` (new).

## Spec
1. **Layout** (full viewport height, no page scroll; only the grid scrolls):
   - **Top bar (48px):** "Monitor" wordmark → `/`, the current sheet name, then a flexible spacer. Reserve two empty slots with stable ids: `#presence-slot` (T10) and `#save-status-slot` (T08). Last comes the **user menu** (avatar): name, role label, "Change password" → `/change-password`, "Admin · Users" (admins only), "Sign out" (POST logout).
   - **Main:** `{children}`.
   - **Bottom tab bar (40px):** a "+" button (if `sheet.create`), an "All sheets" list button (dropdown of every sheet, for when there are many), then the tabs, horizontally scrollable. The active tab is highlighted. Each tab has a chevron menu (also opened by right-click): Rename (inline edit, Enter/Escape), Duplicate…, Direction: RTL / LTR, Move left / Move right, Archive (each item shown only if `can()` allows it). For OM+, an "Archived sheets" entry at the end opens a dialog listing archived sheets with **Restore**.
2. **Routing:** `/` redirects to the first active sheet (`/s/<id>`). With no sheets, show an empty state: "No sheets yet", plus a "Create sheet" button if allowed, otherwise "Ask a project manager to create one." An unknown or archived `sheetId` → `notFound()`.
3. **`lib/realtime/client.ts`**: one `socket.io-client` instance per browser tab (module singleton, `withCredentials`, `path:'/socket.io'`, autoConnect on first use). `RealtimeProvider` (client) mounts it in the app layout, listens for `sheets:changed` → `router.refresh()`, and handles the `session:revoked` / `user:updated` events from T05 if they aren't already handled (don't duplicate).
4. **Server side:** in the socket connection handler, join every socket to room `workspace`. `broadcastSheetsChanged()` emits `sheets:changed` to `workspace`.
5. **`lib/sheets/sheets-repo.ts`**: `listActiveSheets()`, `listArchivedSheets()`, `getSheet(id)`, plus mutations used by the actions. Use `generateKeyBetween` from `fractional-indexing` for positions.
6. **Server actions** (`app/(app)/sheets/actions.ts`): each validates with zod, calls `requirePermission`, runs in `tx()`, writes `monitor_activity_log` (`sheet.create|sheet.rename|sheet.duplicate|sheet.reorder|sheet.direction|sheet.archive|sheet.restore`), bumps `monitor_sheets.version` for rename/direction, then `broadcastSheetsChanged()` and `revalidatePath('/', 'layout')`.
   - `createSheet({ name, template: 'blank' | 'reports_tracker' })` → returns id. The client navigates to it.
   - `renameSheet`, `setSheetDirection`, `moveSheet({ id, beforeId|afterId })`, `archiveSheet`, `restoreSheet` (restored at the end).
   - `duplicateSheet({ id, name, withRows: boolean })`: copies columns with **new ids** and rows with new ids, re-keying each row's `data` from old to new column ids, all in one transaction.
7. **"New sheet" dialog:** name (default "Sheet N") and template choice:
   - **Blank:** one `text` column "Name" and 20 empty rows.
   - **Reports tracker** (`lib/sheets/templates.ts`; mirrors the team's current Google Sheet, `direction:'rtl'`):
     | Column | type | settings |
     |---|---|---|
     | اسم التقرير | text | width 360 |
     | الرابط | link | width 260 |
     | التاريخ | date | |
     | المحرر | person | `{ multiple: true }` |
     | نوع التقرير | status | options: يومي `#fdab3d`, أسبوعي `#e2445c`, ردود أفعال `#a25ddc`, استقصائي `#00c875`, رصد `#784bd1` |
     | تصنيف التقرير | status | options: ثابت `#66ccff`, متطلب `#fdab3d` |
     | الدولة | text | |
     | الحالة | status | options: تم `#00c875`, جاري العمل عليه `#e2445c` |
     | ملاحظات | long_text | width 280 |
     Status option ids: short random strings (`crypto.randomUUID().slice(0,8)`).
8. **Look:** clean, modern, Monday-like. White surface, subtle borders (`--border`), 13–14px UI text, rounded-md, hover states, and the active tab with a 2px `--primary` underline. Everything is keyboard accessible (menus via button + arrow keys, Escape closes).

## Acceptance criteria
- [ ] With 2 browsers open (PM and employee), a sheet created, renamed, reordered or archived by the PM appears in the employee's tab bar within ~1s without reload.
- [ ] An employee sees no create / rename / archive controls, and a direct server action call from an employee is rejected.
- [ ] Duplicate (with and without rows) produces an independent sheet (editing the copy doesn't touch the original) and remaps every column key.
- [ ] The Reports tracker template creates the 9 columns above, RTL.
- [ ] Archived sheets disappear for everyone and can be restored by OM/admin.
- [ ] 50+ sheets: the tab bar scrolls horizontally and "All sheets" lists them all.

## Out of scope
The grid itself (T09). `/s/[sheetId]` shows a placeholder with the sheet name for now.
