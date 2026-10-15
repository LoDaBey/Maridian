# Database

Postgres schema for Monitor. Every table name starts with `monitor_`.

## Migrate

Use the Render **External Database URL** on your machine, and set `DATABASE_SSL=true` in `.env.local`. On Render itself, use the Internal Database URL and `DATABASE_SSL=false`.

```bash
npm run db:migrate
```

The runner applies `db/schema.sql` in one transaction and prints `Schema applied`. It is safe to run again.

## Admin scripts

Each script works in `psql` with `-v` variables. In pgAdmin, DBeaver, or the Render shell, replace every `:'name'` placeholder with a quoted literal (see the comment at the top of the script), then run the whole file.

Passwords typed into a shell command can remain in shell history. Prefer a GUI, or clear the history afterwards.

```bash
psql "$DATABASE_URL" -v email='admin@company.com' -v name='Monitor Admin' -v password='Temp-Pass-2026!' -f db/scripts/create_first_admin.sql
psql "$DATABASE_URL" -v email='amal@company.com' -v name='Amal Mahmoud' -v role='employee' -v password='Temp-Pass-2026!' -f db/scripts/add_user.sql
psql "$DATABASE_URL" -v email='amal@company.com' -v password='Temp-Pass-2026!' -f db/scripts/reset_password.sql
psql "$DATABASE_URL" -v email='amal@company.com' -f db/scripts/deactivate_user.sql
psql "$DATABASE_URL" -f db/scripts/list_users.sql
```

For a Render external URL, require SSL in `psql` as well (`sslmode=require` on the URL, or `PGSSLMODE=require`).

`create_first_admin.sql` inserts one admin only when the database has none, with `must_change_password=false`. `add_user.sql` lower-cases the email, sets `must_change_password=true`, and does nothing when that email already exists. An invalid role is rejected by the table check. `reset_password.sql` and `deactivate_user.sql` delete that user's sessions.

## Cell values

`monitor_rows.data` is a JSON object keyed by column id. T07 enforces these shapes. An empty cell is a missing key. Do not store `null` or `""`.

| type | JSON value |
|---|---|
| text, long_text | `"string"` (max 10 000 chars) |
| link | `{ "url": "https://…", "label": "optional" }` |
| date | `"YYYY-MM-DD"` |
| person | `["<user uuid>", …]` (multi) |
| status | `"<option id>"`. Options live in `column.settings.options: [{ id, label, color }]` |
| number | `123.45` |
| checkbox | `true / false` |
| empty | key absent (never store `null` or `""`, delete the key instead) |
