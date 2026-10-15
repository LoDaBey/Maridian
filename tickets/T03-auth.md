# T03: Authentication (admin-created accounts only)

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Goal
Users log in with the email and password the admin gave them. There's **no sign-up and no "forgot password"** (the admin resets it). On first login they must set a new password. All app pages and the socket require a valid session.

## Before coding, read
- `node_modules/next/dist/docs/01-app/02-guides/authentication.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`
- `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` and `forms.md`
- `node_modules/next/dist/docs/01-app/02-guides/data-security.md`

## Allowed changes
`lib/auth/password.ts`, `lib/auth/session.ts`, `lib/auth/current-user.ts`, `lib/auth/rate-limit.ts`, `proxy.ts`, `app/(auth)/layout.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/login/actions.ts`, `app/(auth)/change-password/page.tsx`, `app/(auth)/change-password/actions.ts`, `app/(app)/layout.tsx` (new, minimal), `app/(app)/page.tsx` (new placeholder), `app/page.tsx`, `app/api/auth/logout/route.ts`, `lib/realtime/socket-server.ts` (auth middleware only).

## Spec
1. **`lib/auth/password.ts`**: `hashPassword(pw)` (bcryptjs, cost 12), `verifyPassword(pw, hash)`, and `validateNewPassword(pw)`: min 10 chars, at least one letter and one digit, not equal to the email. Return error strings for the UI.
2. **`lib/auth/session.ts`**:
   - Cookie name `monitor_session`, `httpOnly`, `sameSite: 'lax'`, `secure` in production, `path: '/'`, lifetime **14 days**.
   - `createSession(userId, ip, ua)`: token = 32 random bytes base64url. Store `sha256(token)` hex in `monitor_user_sessions`. Set the cookie. Update `monitor_users.last_login_at`.
   - `validateSessionToken(token)`: join to the user. Return `null` if expired, missing, or the user is inactive. **Sliding expiry:** if `last_seen_at` is older than 1 hour, update `last_seen_at` and extend `expires_at` to now + 14d.
   - `deleteSession(token)`, `deleteAllSessionsForUser(userId)`.
   - Opportunistic cleanup: delete expired sessions (at most once per hour, in process).
3. **`lib/auth/current-user.ts`** (DAL, `server-only`, wrapped in React `cache()`):
   - `getCurrentUser()` → `SessionUser | null` (`id, email, fullName, role, avatarColor, mustChangePassword`).
   - `requireUser()` → redirects to `/login` when there's no user, and to `/change-password` when `mustChangePassword` (except on that page).
4. **`lib/auth/rate-limit.ts`**: in-memory limiter. Max **5 failed logins per email+IP per 15 min**. Block with "Too many attempts, try again in N minutes". Reset on success.
5. **Login page** `/login`: a clean centered card with the "Monitor" wordmark, email, password (show/hide toggle), and a "Sign in" button with a pending state (`useActionState`). The generic error is "Email or password is incorrect" (don't reveal which one, or whether the account is inactive). Under the form, the hint "Accounts are created by your administrator." On success: redirect to `/change-password` if `must_change_password`, otherwise `/`. Run a bcrypt compare even when the user doesn't exist (dummy hash), to keep timing even.
6. **Change password** `/change-password`: current password, new, and confirm. Validate with `validateNewPassword`. On success, set the hash, set `must_change_password=false`, delete **other** sessions of this user, and redirect to `/`. Reachable any time from the user menu (T06).
7. **Logout** `POST /api/auth/logout`: delete the session, clear the cookie, and redirect to `/login`.
8. **`proxy.ts`**: an optimistic check only (cookie present?). No cookie and the path isn't `/login`, `/api/health` or static assets → redirect to `/login`. Cookie present on `/login` → redirect to `/`. Real validation stays in `requireUser()`.
9. **`app/(app)/layout.tsx`**: calls `requireUser()`. The real shell comes in T06; for now render children plus a tiny header with the user's name and a logout button.
10. **`app/page.tsx`**: remove the placeholder so `/` is served by `app/(app)/page.tsx` (placeholder "Welcome, {name}"). If both routes conflict, move it and explain.
11. **Socket auth** in `lib/realtime/socket-server.ts`: `io.use()` parses the `monitor_session` cookie from `socket.handshake.headers.cookie`, calls `validateSessionToken`, and attaches `socket.data.user`. On failure **or if `must_change_password` is true**, call `next(new Error('unauthorized'))`. `lib/auth/session.ts` must not import `server-only` (see the README traps). Join every authenticated socket to the room `user:<id>` (so admin actions can kick them later).

## Acceptance criteria
- [ ] Visiting any app URL logged out → `/login`.
- [ ] A wrong password and an unknown email show the same message, and the 6th failure in 15 min is blocked.
- [ ] A user created with `db/scripts/add_user.sql` can log in, is forced to `/change-password`, and can't reach `/` until they change it.
- [ ] After a password change, other browsers logged in as that user are logged out on their next request.
- [ ] A deactivated user (`deactivate_user.sql`) is logged out on the next request and can't log in.
- [ ] The cookie is httpOnly, and the DB holds only the token hash (paste the `token_hash` length = 64).
- [ ] A socket connection without a valid cookie is rejected. With a cookie, `socket.data.user` is set.
- [ ] No password, token or hash appears in any log.

## Out of scope
Roles and permissions (T04), admin UI (T05), styling of the app shell (T06).
