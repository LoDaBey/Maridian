# Monitor

Realtime sheet tracker for the reports team.

## Prerequisites

- Node.js 20+

## Setup

```bash
cp .env.example .env.local
npm i
npm run dev
```

On Windows PowerShell, copy the example env file with `Copy-Item .env.example .env.local`.

Architecture and ticket order: [tickets/00-README.md](tickets/00-README.md).

## Deploy

**Hosting: Render only.** Live sync and presence need a long-running Node process holding Socket.IO connections (`server.ts`). Vercel runs Next.js as serverless functions with no custom server and no persistent WebSockets, so on Vercel the grid would load but nothing would sync.

1. Push to GitHub (private repo).
2. In Render, go to New, then Blueprint, and pick the repo.
3. Choose: new database, **or** delete the `databases` block and paste the existing DB's **Internal** URL into `DATABASE_URL` (same region as the web service). Tables are prefixed `monitor_`, so this app can share a database that already exists.
4. Set `APP_URL` to the Render URL (e.g. `https://monitor.onrender.com`). It must match exactly, or sockets are refused by the origin check.
5. Deploy. `preDeployCommand` runs the schema.
6. Run `db/scripts/create_first_admin.sql` once (Render shell, or locally with the **External** URL and `DATABASE_SSL=true`):

```bash
psql "$DATABASE_URL" -v email='admin@company.com' -v name='Monitor Admin' -v password='choose-a-temporary-password' -f db/scripts/create_first_admin.sql
```

7. Log in and create users at `/admin/users`.

The `starter` plan (or higher) is needed. Free web services sleep after inactivity and drop live connections.

## Operations

**Add a user.** An admin can use **Admin → Users → New user**. From SQL, when the UI is unavailable:

```bash
psql "$DATABASE_URL" -v email='person@company.com' -v name='Person Name' -v role='employee' -v password='choose-a-temporary-password' -f db/scripts/add_user.sql
```

The new account must change that password on first login. Roles are `employee`, `team_leader`, `project_manager`, `operations_manager`, and `admin`.

**Reset a password.** In the users screen, choose **Reset password** and share the generated password. From SQL:

```bash
psql "$DATABASE_URL" -v email='person@company.com' -v password='choose-a-temporary-password' -f db/scripts/reset_password.sql
```

That sets the password, forces a change on next login, and deletes the user's sessions.

**Deactivate.** The users screen marks the account inactive and disconnects its open sessions. `db/scripts/deactivate_user.sql` does the same from SQL.

**Backups.** Render's backup window and retention depend on the database plan you picked. Confirm the plan's backup policy in the Render database page before relying on it. The app does not run its own backup job.

**Scaling.** Do not scale the web service above 1 instance without a Socket.IO adapter. A second instance has its own presence map and its own socket rooms, so live edits and cursors would split across processes.
