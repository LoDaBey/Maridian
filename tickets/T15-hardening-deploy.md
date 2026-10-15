# T15: Hardening, end-to-end tests, Render deployment

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off. **This ticket fixes nothing in the features themselves.** If a test exposes a bug, mark it `test.fixme`, describe it in the hand-off, and leave the fix to a follow-up ticket.

## Goal
Make it safe to run for the whole team: security headers, origin checks, error states, a proof by automated tests that realtime sync and permissions hold, and a one-click Render deploy.

## Before coding, read
`docs/01-app/02-guides/self-hosting.md`, `production-checklist.md`, `content-security-policy.md`, `docs/01-app/01-getting-started/10-error-handling.md`.

## Allowed changes
`next.config.ts` (headers only), `lib/realtime/socket-server.ts` (origin check + connection-level error handling only), `app/api/auth/logout/route.ts` (Origin check only), `app/(app)/error.tsx`, `app/(app)/not-found.tsx`, `app/global-error.tsx`, `app/(app)/_components/ConnectionBanner.tsx` (new), `app/(app)/layout.tsx` (mount the banner only), `server.ts` (unhandled rejection + pool error logging only), `render.yaml` (new), `playwright.config.ts`, `tests/e2e/*`, `scripts/load-test.ts`, `scripts/e2e-seed.ts`, `package.json` (scripts only), `README.md` (Deploy + Operations sections).

## Spec
1. **Security headers** (`next.config.ts` `headers()`): `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Strict-Transport-Security` (production only), and a CSP that allows self, the Google Fonts handled by `next/font` (self-hosted, so self), `connect-src 'self' wss: ws:` (dev) / `'self' wss://<host>`. Follow the Next 16 CSP guide for nonces if inline scripts need them.
2. **Origin checks:** the socket handshake rejects an `Origin` that isn't `APP_URL`, and the logout POST rejects a cross-origin `Origin`. (Server actions already have built-in origin checks; confirm in the docs and note it.)
3. **Error UX:** `error.tsx` ("Something went wrong", Retry) and `not-found.tsx` ("Sheet not found" → back to sheets). `ConnectionBanner` is a thin top banner "Reconnecting…" after 2s disconnected, and "Connection lost. Your changes are kept and will sync." after 15s. It hides on reconnect.
4. **Server resilience:** `pool.on('error')` logs it without crashing, and `process.on('unhandledRejection')` logs it. The socket handlers already ack errors (verify).
5. **Playwright** (`tests/e2e`). Uses `DATABASE_URL_TEST` + `scripts/e2e-seed.ts` (runs the schema, creates admin/pm/employee test users with known **test** passwords stored in `.env.test.example`, and a Reports tracker sheet). Each test uses its own browser contexts:
   - `auth.spec`: logged out → /login. Wrong password message. First login is forced to change password. The employee can't open `/admin/users`.
   - `realtime.spec`: **two contexts (PM + employee) on the same sheet**. A cell edit appears in the other within 1s. Different cells of the same row both persist after a reload. Presence avatars and cursors are visible to each other.
   - `offline.spec`: the employee goes offline (`context.setOffline(true)`), edits 3 cells, the status shows Offline, they come back online, and the PM sees all 3, with the DB values verified.
   - `permissions.spec`: the employee has no column menu, a forged `column.delete` via `page.evaluate` on the socket is rejected, and they can't delete the PM's row.
   - `admin.spec`: the admin creates a user, the new user logs in, the admin deactivates them, and the open session is kicked.
6. **Load test** `scripts/load-test.ts`: 25 socket clients (5 test users × 5) join one sheet and each sends 200 random `cell.set` ops over 30s. At the end, assert every client's final state equals a fresh snapshot (no divergence), no ops were lost (count the acked ops against `version`), and p95 ack latency is under 150ms locally. Print a summary.
7. **Render** (`render.yaml`, Blueprint):
   - `databases`: `monitor-db` (PostgreSQL 16, plan placeholder `basic-256mb`. **The user picks the plan**).
   - `services`: a web service `monitor`, runtime node, `buildCommand: npm ci && npm run build`, `preDeployCommand: npm run db:migrate`, `startCommand: npm start`, `healthCheckPath: /api/health`, `numInstances: 1` (with a comment on why: in-memory presence), and env vars `DATABASE_URL` from `monitor-db` connectionString (internal), `DATABASE_SSL=false`, `SESSION_SECRET` generateValue, `APP_URL` (sync:false), `NODE_VERSION=20`.
   - README **Deploy**: Blueprint steps, then run `db/scripts/create_first_admin.sql` once from the Render DB shell or locally with the External URL, log in, and create users.
   - README **Operations**: adding users (UI or `db/scripts/add_user.sql`), resetting passwords, backups (Render plan dependent), and "don't scale above 1 instance without a Socket.IO adapter".

## Acceptance criteria
- [ ] `npx playwright test` is green (or a `fixme` with an explanation per failing test).
- [ ] `tsx scripts/load-test.ts` shows 0 divergence and 0 lost ops. Paste the summary.
- [ ] The response headers are present (paste `curl -I`).
- [ ] A cross-origin socket connection is refused.
- [ ] A Render Blueprint deploy goes green: `/api/health` OK and two real users editing live on the deployed URL.

## Out of scope
Feature changes, horizontal scaling, SSO, email delivery.
