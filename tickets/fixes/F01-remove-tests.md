# F01: Remove the automated tests

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Goal
The owner has decided not to keep automated tests. Remove the unit tests, the end-to-end tests, the load test and their tooling, so `npm install` is lighter and nothing refers to them. **App code must not change.**

## Allowed changes
Delete: `tests/` (all of it), `vitest.config.ts`, `playwright.config.ts`, `scripts/e2e-seed.ts`, `scripts/load-test.ts`, `scripts/dev-two-clients.ts`, `.env.test.example`.
Edit: `package.json` + `package-lock.json`, `README.md` (only the lines that mention tests, Playwright, Vitest, the load test or `DATABASE_URL_TEST`), `.gitignore` (only the `/test-results` and `/playwright-report` lines).

**Keep** `scripts/db-migrate.ts` and `scripts/seed-big-sheet.ts`. They aren't tests.

## Spec
1. Delete the files listed above.
2. `package.json`: remove the scripts `test`, `test:e2e`, `e2e:seed` and `load-test`, and uninstall `vitest` and `@playwright/test` with `npm uninstall` so the lockfile updates.
3. If anything outside the deleted files imports from `tests/`, `vitest` or `@playwright/test`, **stop and list it**. Don't edit app code.
4. `README.md`: delete the test and load-test sections and any `DATABASE_URL_TEST` mention. Change nothing else.

## Acceptance criteria
- [ ] `git grep -nE "vitest|playwright|DATABASE_URL_TEST|load-test|e2e"` returns nothing outside `tickets/`.
- [ ] `npx tsc --noEmit`, `npm run lint` and `npm run build` pass.
- [ ] `npm run dev` starts and a sheet opens and edits as before.
