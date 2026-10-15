# Monitor Sheets: Cursor ticket queue

A realtime, Google-Sheets-style tracker that replaces Monday / Google Sheets for the reports team.
Users can't sign up. The admin creates every account and hands out the email and password.

**Run order:** T01 → T15, one at a time, in order. Each ticket depends on the ones before it.
After each ticket, Cursor commits locally (no push) and pastes its **Hand-off report**. Bring the report (or just say "review T0X") back to Claude for review before starting the next ticket.

| # | Ticket | Depends on |
|---|--------|-----------|
| T01 | [Project foundation and realtime server](T01-foundation.md) | none |
| T02 | [Database schema and SQL scripts](T02-database.md) | T01 |
| T03 | [Authentication](T03-auth.md) | T02 |
| T04 | [Roles and permissions](T04-rbac.md) | T03 |
| T05 | [Admin user management](T05-admin-users.md) | T04 |
| T06 | [App shell and sheet tabs](T06-shell-tabs.md) | T04 |
| T07 | [Sheet engine (server ops + socket)](T07-sheet-engine.md) | T06 |
| T08 | [Client sync layer and autosave](T08-sync-client.md) | T07 |
| T09 | [Grid UI and column types](T09-grid-ui.md) | T08 |
| T10 | [Live presence](T10-presence.md) | T09 |
| T11 | [Column and row management UI](T11-columns-rows-ui.md) | T09 |
| T12 | [Find, filter, sort](T12-find-filter-sort.md) | T09 |
| T13 | [CSV import / export](T13-csv.md) | T11 |
| T14 | [Activity history](T14-history.md) | T11 |
| T15 | [Hardening, e2e tests, Render deploy](T15-hardening-deploy.md) | all |

### Follow-up fixes (run after T15, in order)
| # | Ticket |
|---|--------|
| F01 | [Remove the automated tests](fixes/F01-remove-tests.md) |
| F02 | [Paste must understand labels, names and display dates](fixes/F02-paste-display-values.md) |
| F03 | [Know who "me" is in the sheet, plus small cleanups](fixes/F03-viewer-identity-cleanup.md) |
| F04 | [Make the Render deploy work](fixes/F04-deploy-render.md) |

---

## Fixed architecture (every ticket follows this, so don't re-decide it)

- **Framework:** Next.js **16.4.1** App Router, React 19.3, TypeScript strict, Tailwind v4 (already installed).
  This is NOT the Next.js in your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing code. Middleware is now **`proxy.ts`** (`docs/01-app/01-getting-started/16-proxy.md`). `cookies()` / `headers()` / `params` are **async** (`await`).
- **One process, one port:** a custom server `server.ts` (see `docs/01-app/02-guides/custom-server.md`) runs Next's request handler **and** a Socket.IO server on the same HTTP server. Run with `tsx`. Don't use `output: 'standalone'` (it's incompatible with a custom server).
- **Host:** Render Web Service (Node) + Render PostgreSQL. Single instance. Presence lives in server memory. Scaling to more than one instance needs a Socket.IO adapter, which is out of scope.
- **DB access:** `pg` (node-postgres) with a single shared `Pool` and plain parameterised SQL. **No ORM.** Every table is prefixed `monitor_`.
- **Auth:** our own email + password, `bcryptjs` (cost 12, compatible with Postgres `pgcrypto` `crypt()` so users can be added from SQL), opaque session token in an httpOnly cookie, and only a **SHA-256 hash** of the token stored in the DB.
- **Validation:** `zod` on every server input (server actions, route handlers, socket events).
- **Realtime model:** server-authoritative operations. The client applies an op optimistically, then sends it over the socket. The server validates it, checks permissions, writes it in one transaction, bumps the per-sheet `version`, logs it, and broadcasts it to the sheet room. Conflicts resolve **last-writer-wins per cell, in server order**. Two people editing different cells of the same row never overwrite each other.
- **Autosave:** a cell is saved when its editor **commits** (Enter, Tab, blur, click elsewhere, or picking a value in a dropdown or date picker). Nothing is saved per keystroke, and there's no Save button.
- **IDs:** UUIDs. Rows and columns are created with client-generated `crypto.randomUUID()` so optimistic inserts keep a stable id.
- **Ordering:** `fractional-indexing` string keys in a `position text COLLATE "C"` column for rows, columns and sheet tabs.
- **Client state:** `zustand` (selector-based, so presence updates don't re-render the whole grid).
- **Grid:** `@tanstack/react-table` + `@tanstack/react-virtual`, DOM-based (needed for RTL and presence overlays). Don't use canvas grids.
- **Icons:** `lucide-react`. **CSV:** `papaparse`. **Tests:** none (removed in F01).
- **Hosting:** Render only. Vercel can't run the custom Socket.IO server (see F04).
- **Language and direction:** the app chrome is English (LTR). Each **sheet** has a `direction` (`rtl` default, or `ltr`), because the team's data is Arabic. Load **IBM Plex Sans Arabic** + **Inter** via `next/font`.

### Two traps of the custom server (read twice)
1. **`server-only` crashes outside Next's bundler.** `server.ts` runs under plain `tsx`, so any module it imports, directly or indirectly (`lib/env`, `lib/db`, `lib/auth/session`, `lib/auth/password`, `lib/rbac`, `lib/sheets/*`, `lib/realtime/*`, `lib/users`), must **not** `import 'server-only'`. Only page-level DAL files such as `lib/auth/current-user.ts` may use it.
2. **Two copies of every module.** Next bundles its own copy of `lib/*` for pages and server actions, separate from the copy `server.ts` loads. So **every process-wide singleton (pg Pool, Socket.IO `io`, caches) must live on `globalThis`**, otherwise server actions get a different, empty instance and broadcasts silently go nowhere.

### Roles (lowest → highest)
`employee` < `team_leader` < `project_manager` < `operations_manager` < `admin`. The full matrix is in T04. The server enforces every check. The UI only hides controls.

### Folder layout (create as needed)
```
server.ts                  custom server (Next + Socket.IO)
proxy.ts                   optimistic auth redirect
db/schema.sql              idempotent schema
db/scripts/*.sql           admin SQL scripts (add user, reset password...)
scripts/db-migrate.ts      runs db/schema.sql
lib/db.ts                  Pool + query/tx helpers
lib/auth/*                 sessions, password, getCurrentUser, requireUser
lib/rbac.ts                role matrix + can()
lib/sheets/ops.ts          op zod schemas + types (shared client/server)
lib/sheets/apply-op.ts     server: apply one op in a transaction
lib/sheets/snapshot.ts     server: load a sheet snapshot
lib/realtime/*             socket server wiring, presence registry
app/(auth)/login/...       login + change-password
app/(app)/...              authenticated app (shell, sheets, admin)
components/grid/*          grid UI
components/presence/*      avatars, cursors
stores/sheet-store.ts      zustand store per open sheet
tests/unit, tests/e2e
```

### Environment variables (`.env.local`, documented in `.env.example`)
```
DATABASE_URL=postgres://...          # Render "External Database URL" locally, "Internal" on Render
DATABASE_SSL=true                    # true for external URL, false for internal
SESSION_SECRET=<32+ random chars>    # used to sign the CSRF/socket token if needed
APP_URL=http://localhost:3000
NODE_ENV=development
```

---

## Rules every ticket repeats (Cursor must obey)

1. **Change only what the ticket asks for.** Don't change, remove, "improve" or re-tune anything outside the ticket, including design, behaviour, copy, layout, animation, settings and defaults, even if it looks better.
2. **Only touch the files and areas listed under "Allowed changes".** If the work seems to need another file, or something nearby looks wrong, **stop and write it under "Questions / blockers"** in the hand-off. Don't do it.
3. Read the matching Next 16 doc in `node_modules/next/dist/docs/` before using any Next API.
4. No new dependencies beyond the ones the ticket names. If you need one, ask in the hand-off.
5. `npm run lint`, `npx tsc --noEmit` and `npm run build` must pass. (Automated tests were removed by owner decision in F01. Verify manually in the browser.)
6. Never commit `.env*` files with real values. Never log passwords, session tokens or `password_hash`.
7. Commit locally when done: `git commit -m "T0X: <title>"`. **Don't push.**
8. Finish with the **Hand-off report** below.

### Hand-off report (paste at the end of every ticket)
```
## Hand-off T0X
Files changed: (list)
What I built: (3-6 bullets)
How I verified: (commands run + results, manual steps)
Acceptance criteria: (each criterion → PASS / FAIL / NOT TESTED + note)
Deviations from the ticket: (none, or what and why)
Questions / blockers: (anything you stopped on)
```

## Review protocol (Claude)
For each hand-off, Claude reads the commit diff (`git show`), checks every acceptance criterion against the code, runs lint/typecheck/tests, and writes **follow-up fix tickets** (`tickets/fixes/F-T0X-*.md`) for anything missing or wrong before the next ticket starts.
