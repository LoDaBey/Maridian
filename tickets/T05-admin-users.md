# T05: Admin user management

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Goal
The admin creates accounts in the app (as well as via SQL), sees the credentials once to share them, and can change roles, reset passwords and deactivate people. Changes apply **immediately**, including to users who are currently connected.

## Allowed changes
`app/(app)/admin/users/page.tsx`, `app/(app)/admin/users/actions.ts`, `app/(app)/admin/users/_components/*`, `lib/users.ts` (new: user queries), `lib/realtime/socket-server.ts` (add `refreshUserSockets` / `kickUser` helpers only), `lib/auth/password.ts` (add `generatePassword` only), `lib/colors.ts` (new).

## Spec
1. **Access:** `requirePermission('user.manage')` on the page and in **every** action. Non-admins get 403/404.
2. **`lib/colors.ts`**: `PRESENCE_COLORS`: 12 distinct, accessible colours (Monday palette: `#0073ea #00c875 #fdab3d #e2445c #a25ddc #037f4c #ff642e #66ccff #bb3354 #9cd326 #ff158a #784bd1`). `pickUserColor(existingCount)` cycles through them.
3. **`generatePassword()`**: 14 chars from an unambiguous alphabet (no `0O1lI`), guaranteed letter + digit + symbol, using `crypto.randomInt`.
4. **Users page `/admin/users`**:
   - Table: avatar (initials on `avatar_color`), full name, email, role badge, Active/Inactive, last login (relative), created. Client-side search box. Sorted by role rank desc, then name.
   - **New user** dialog: full name, email, role (select, default Employee), password (pre-filled with `generatePassword()`, plus Regenerate and show/hide), and a "Require password change on first login" checkbox (default **on**). Validate with zod (email format, lower-cased, unique; an error on duplicates).
   - After creating: a **one-time credentials panel** with a "Copy" button that copies:
     ```
     Monitor login
     URL: {APP_URL}/login
     Email: {email}
     Temporary password: {password}
     ```
     The password is never shown again, and never stored in plain text anywhere.
   - **Row actions:** Edit (name, role, avatar colour), Reset password (generates one, shows the same one-time panel, sets `must_change_password=true`, deletes all their sessions), Deactivate / Reactivate.
5. **Guards (server-side):** an admin can't deactivate themselves, can't change their own role, and the **last active admin** can't be demoted or deactivated.
6. **Live effect on connected users** (in `socket-server.ts`):
   - `kickUser(userId)`: emits `session:revoked` to room `user:<id>`, then `disconnectSockets(true)` for that room. Used on deactivate and reset password.
   - `refreshUserSockets(userId)`: re-reads the user and updates `socket.data.user` for every socket in `user:<id>` (`io.in(room).fetchSockets()`), then emits `user:updated` with the new public profile. Used on role, name or colour change.
   - The client handling (redirect to `/login` on `session:revoked`, `router.refresh()` on `user:updated`) goes in a tiny client component mounted in `app/(app)/layout.tsx`. **List it in the hand-off if you had to touch that layout.**
7. **Audit:** write `monitor_activity_log` rows with `sheet_id = NULL`, `action` in `user.create | user.update | user.reset_password | user.deactivate | user.reactivate`, and `new_value` holding the changed fields (**never** passwords or hashes).

## Acceptance criteria
- [ ] Only admins can open `/admin/users` or call its actions. Verify an employee's direct call to an action fails.
- [ ] A created user can log in with the copied credentials and is forced to change the password.
- [ ] Deactivating a logged-in user in another browser kicks them to `/login` within ~1s.
- [ ] Changing a user's role takes effect without them logging out (their next socket op uses the new role).
- [ ] The last-admin and self-demotion guards work.
- [ ] The audit rows exist and contain no secrets.

## Out of scope
Teams/groups, invitations by email, deleting users (deactivate only, to keep history).
