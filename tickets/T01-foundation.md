# T01: Project foundation and realtime server

> Read `tickets/00-README.md` first. It defines the fixed architecture and the rules.
> **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Goal
Turn the fresh create-next-app into the skeleton every later ticket builds on: a custom Node server serving Next + Socket.IO on one port, a Postgres pool, env handling, and base styling/fonts.

## Before coding, read
- `node_modules/next/dist/docs/01-app/02-guides/custom-server.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/13-fonts.md`
- `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`

## Allowed changes
`package.json`, `package-lock.json`, `server.ts` (new), `lib/db.ts` (new), `lib/env.ts` (new), `lib/realtime/socket-server.ts` (new), `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `app/api/health/route.ts` (new), `.env.example` (new), `.gitignore`, `README.md`, `tsconfig.json` (only if `tsx` needs it).

## Dependencies to add
- runtime: `pg`, `socket.io`, `socket.io-client`, `zod`, `bcryptjs`, `zustand`, `@tanstack/react-table`, `@tanstack/react-virtual`, `fractional-indexing`, `lucide-react`, `papaparse`, `tsx`
- dev: `@types/pg`, `@types/bcryptjs` (only if the package lacks types), `@types/papaparse`, `vitest`, `@playwright/test`

## Spec
1. **`lib/env.ts`**: parse `process.env` with zod once and export a typed `env` object (`DATABASE_URL` required, `DATABASE_SSL` boolean default false, `SESSION_SECRET` min 32, `APP_URL` url, `NODE_ENV`). Fail fast with a clear message listing missing vars. Do **not** `import 'server-only'` here. `server.ts` loads this file under plain `tsx` (see the README traps). Cache the parsed result on `globalThis`, and do the same for the Pool and `io`.
2. **`lib/db.ts`**:
   - A single `Pool` cached on `globalThis` (survives dev hot reload). `max: 10`, `idleTimeoutMillis: 30_000`, `ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined`.
   - `query<T>(text, params)` → `T[]` rows.
   - `queryOne<T>(text, params)` → `T | null`.
   - `tx<T>(fn: (client) => Promise<T>)` → BEGIN / COMMIT, ROLLBACK on throw, always release.
3. **`lib/realtime/socket-server.ts`**: export `attachSocketServer(httpServer)` that creates `new Server(httpServer, { path: '/socket.io', cors: { origin: env.APP_URL, credentials: true } })`, stores the instance on `globalThis.__io` with a `getIO()` getter (so server actions can broadcast later), and logs connect/disconnect. No auth yet (T03 adds it).
4. **`server.ts`**: follow the docs pattern. `next({ dev })`, `app.prepare()`, `createServer((req,res)=>handle(req,res))`, `attachSocketServer(server)`, listen on `process.env.PORT || 3000`, bind `0.0.0.0`. Graceful shutdown on SIGTERM/SIGINT: close io, close http server, `pool.end()`.
5. **Scripts** in `package.json`:
   - `"dev": "tsx watch --clear-screen=false server.ts"` (if watch mode fights Next's HMR, use plain `tsx server.ts` and say so)
   - `"build": "next build"`
   - `"start": "cross-env NODE_ENV=production tsx server.ts"`. Windows needs this to work, so add `cross-env` as a dependency, **or** set `NODE_ENV` inside `server.ts` from `process.argv`. Pick one and explain.
   - `"lint": "eslint"`, `"typecheck": "tsc --noEmit"`
6. **`app/api/health/route.ts`**: `GET` runs `select 1` and returns `{ ok: true, db: true, time }`. Return 503 `{ ok:false }` on DB error. No auth.
7. **Base UI**:
   - `app/layout.tsx`: load **Inter** (latin) and **IBM Plex Sans Arabic** (arabic, weights 400/500/600/700) with `next/font/google`, expose them as CSS variables, set `<html lang="en">`, and set metadata title "Monitor".
   - `app/globals.css`: Tailwind v4, design tokens as CSS variables (`--bg`, `--surface`, `--border`, `--text`, `--muted`, `--primary` (#0073ea, Monday-like blue), `--danger`, `--success`), and a font stack `Inter, "IBM Plex Sans Arabic", system-ui`. Light theme only.
   - `app/page.tsx`: replace the create-next-app demo with a minimal placeholder ("Monitor, coming soon"). T03 turns it into a redirect.
8. **`.env.example`**: every variable from the README with comments. `.gitignore`: make sure `.env*` (except `.env.example`), `/test-results`, `/playwright-report` are ignored.
9. **`README.md`**: replace the boilerplate with: prerequisites (Node 20+), `cp .env.example .env.local`, `npm i`, `npm run dev`, and a pointer to `tickets/00-README.md`.

## Acceptance criteria
- [ ] `npm run dev` starts one process. `http://localhost:3000` renders the placeholder, and editing `app/page.tsx` still hot-reloads.
- [ ] `GET /api/health` returns `{ ok: true, db: true }` against the Render DB (`DATABASE_SSL=true`).
- [ ] A browser console `io({ path: '/socket.io' })` connects (the server logs connect), on the **same port** as the app.
- [ ] `npm run build && npm start` works (production mode serves the app + socket).
- [ ] Missing `DATABASE_URL` → the process exits with a readable error.
- [ ] `npm run lint` and `npm run typecheck` pass.

## Out of scope
Auth, schema, any UI beyond the placeholder, Render deploy config (T15).
