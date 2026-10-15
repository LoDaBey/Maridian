# T04: Roles and permissions (RBAC)

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Goal
One source of truth for "who can do what", used by the server (server actions, route handlers, socket ops) and by the UI to hide controls. Also set up the unit test runner.

## Allowed changes
`lib/rbac.ts`, `lib/auth/current-user.ts` (add `requireRole`/`requirePermission` only), `tests/unit/rbac.test.ts`, `vitest.config.ts`, `package.json` (add `"test": "vitest run"` only).

## Spec
1. `lib/rbac.ts`: **no server-only imports** (shared with the client).
```ts
export const ROLES = ['employee','team_leader','project_manager','operations_manager','admin'] as const;
export type Role = typeof ROLES[number];
export const ROLE_LABEL: Record<Role,string> = { employee:'Employee', team_leader:'Team Leader', project_manager:'Project Manager', operations_manager:'Operations Manager', admin:'Admin' };
export const roleRank = (r: Role) => ROLES.indexOf(r);
export type Action =
  | 'sheet.view' | 'cell.edit' | 'row.insert' | 'row.delete.own' | 'row.delete.any' | 'row.move'
  | 'sheet.create' | 'sheet.rename' | 'sheet.duplicate' | 'sheet.reorder' | 'sheet.direction'
  | 'column.manage'          // add / rename / change type / edit status options / delete / reorder
  | 'column.resize'
  | 'sheet.archive' | 'sheet.restore'
  | 'history.view' | 'csv.export' | 'csv.import'
  | 'user.manage';
export function can(role: Role, action: Action): boolean
```
2. **Matrix** (minimum role that's allowed; every higher role is allowed too):

| Action | Min role |
|---|---|
| sheet.view, cell.edit, row.insert, row.delete.own, csv.export | employee |
| row.delete.any, row.move, column.resize, history.view | team_leader |
| sheet.create, sheet.rename, sheet.duplicate, sheet.reorder, sheet.direction, column.manage, csv.import | project_manager |
| sheet.archive, sheet.restore | operations_manager |
| user.manage | admin |

`row.delete.own` means rows where `created_by = me`. Write the matrix as a single `Record<Action, Role>` constant so it reads like the table.
3. `canDeleteRow(user, row)` helper: `can(role,'row.delete.any') || (can(role,'row.delete.own') && row.created_by === user.id)`.
4. In `lib/auth/current-user.ts` add `requirePermission(action)`: calls `requireUser()`, then throws or returns a 403 (forbidden) when `!can`. For pages, use `forbidden()` / `notFound()` per the Next 16 docs (check `docs/01-app/03-api-reference/04-functions/` for `forbidden`; if it requires an experimental flag, use `notFound()` and say so).
5. Vitest config (node env, `@/` alias). Tests cover every row of the matrix for all five roles, plus `canDeleteRow`.

## Acceptance criteria
- [ ] `npm run test` passes, with at least 5 roles × all actions asserted.
- [ ] `lib/rbac.ts` imports cleanly in a client component (no server-only deps).
- [ ] The matrix in code matches the table above exactly.

## Out of scope
Applying the checks to real features. Each later ticket calls `can()` / `requirePermission()` itself.
