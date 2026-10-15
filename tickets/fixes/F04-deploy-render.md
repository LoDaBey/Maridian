# F04: Make the Render deploy work (and document why not Vercel)

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Problems (found in review)
1. **The build would fail on Render.** `render.yaml` sets `NODE_ENV=production` as an env var. With that set, `npm ci` skips devDependencies, but `next build` needs `typescript`, `tailwindcss` and `@tailwindcss/turbopack` (all devDependencies). `npm start` already forces production mode through `server.ts --production`, so the env var isn't needed.
2. **Vercel can't run this app.** Live sync and presence need a long-running Node process holding Socket.IO connections (`server.ts`). Vercel runs Next.js as serverless functions with no custom server and no persistent WebSockets, so on Vercel the grid would load but nothing would sync. This must be written down so nobody tries it.
3. The owner already has a Render Postgres. Every table is prefixed `monitor_`, so the app can share that database instead of creating a new paid one.

## Allowed changes
`render.yaml`, `README.md` (Deploy section only).

## Spec
1. `render.yaml`:
   - Remove the `NODE_ENV` env var.
   - Change `buildCommand` to `npm ci --include=dev && npm run build`.
   - Keep the `databases:` block, but add a comment above it: "Delete this block and set DATABASE_URL by hand to reuse an existing Render Postgres (tables are prefixed monitor_)".
   - Change `DATABASE_URL` so a hand-set value is possible: keep `fromDatabase` as the default and describe the manual alternative in the comment.
2. README **Deploy** section:
   - **Hosting: Render only.** One short paragraph explaining why not Vercel (point 2 above).
   - Steps:
     1. Push to GitHub (private repo).
     2. In Render, go to New, then Blueprint, and pick the repo.
     3. Choose: new database, **or** delete the `databases` block and paste the existing DB's **Internal** URL into `DATABASE_URL` (same region as the web service).
     4. Set `APP_URL` to the Render URL (e.g. `https://monitor.onrender.com`). It must match exactly, or sockets are refused by the origin check.
     5. Deploy. `preDeployCommand` runs the schema.
     6. Run `db/scripts/create_first_admin.sql` once (Render shell, or locally with the **External** URL and `DATABASE_SSL=true`).
     7. Log in and create users at `/admin/users`.
   - Note: the `starter` plan (or higher) is needed. Free web services sleep after inactivity and drop live connections.

## Acceptance criteria (manual, on Render)
- [ ] The Blueprint build succeeds.
- [ ] `https://<app>.onrender.com/api/health` returns `{ ok: true, db: true }`.
- [ ] Two people in different browsers edit the same sheet and see each other's cursors and edits live on the deployed URL.
