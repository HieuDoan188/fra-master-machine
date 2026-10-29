---
name: solova-reference
description: Orientation notes for the Solova codebase (Next.js 15 + tRPC + Prisma + PostgreSQL) used in MTM practice matches. Read when the assigned matchRoot contains Solova (src/src/server, prisma/schema). Navigation help only; the backlog brief, company KB and tests are the authority.
---

# Solova reference (navigation, not answers)

Use this to locate code fast. It is **not** an answer key: each match's brief, `company_tool` KB policies, official check runners and tests decide what is correct. Verify every note against the current source.

## Module map (paths relative to matchRoot)

| Area | Where |
|---|---|
| Accounting: double-entry ledger, P&L, balance sheet | `src/src/server/services/accounting/{chart-of-accounts,posting,reports}.ts`, `src/src/server/api/routers/accounting.ts`, `src/src/components/accounting/*-tab.tsx`, `src/src/lib/money.ts`, `src/src/schemas/accounting.ts` |
| CRM: companies, contacts, contracts, billing models | `src/src/app/(app)/companies/[id]/company-detail.tsx`, `src/src/components/company/*`, `src/src/server/api/routers/{company,contract,contact}.ts`, `src/src/schemas/{company,contract,contact}.ts` |
| Kanban: boards, lists, cards, checklists, automation, calendar/table/stats | `src/src/lib/position.ts`, `src/src/components/board/*`, `src/src/server/services/{card,automation,activity}.ts`, `src/src/server/api/routers/{board,list,card,task}.ts` |
| Time, projects, dashboard, heatmap | `src/src/app/(app)/time/time-view.tsx`, `src/src/components/time/*`, `src/src/app/(app)/projects/[id]/project-detail.tsx`, `src/src/app/(app)/dashboard/dashboard-view.tsx`, `src/src/components/dashboard/heatmap.tsx`, `src/src/server/services/heatmap.ts` |
| App shell / layout / styling | `src/src/app/(app)/layout.tsx`, `src/src/components/layout/*`, `src/src/styles/globals.css` (Tailwind v4, CSS-first tokens) |
| Database | `src/prisma/schema/*.prisma` (one file per module), migrations in `src/prisma/schema/migrations/`, seed `src/prisma/seed.ts` |
| Tests | `src/tests/*.test.ts` (vitest, real Postgres via `TEST_DATABASE_URL`) |

## Known facts from practice

- Money is BIGINT minor units; convert with the currency's minor-unit factor (`src/src/lib/money.ts`). Zero-decimal currencies use factor 1.
- Card/list ordering uses fractional positions with a 65536 gap (`src/src/lib/position.ts`).
- Baseline: `pnpm test` is 11/12. `tests/cascade.test.ts` expects company deletion to be RESTRICTED, but migration `…_company_delete_cascades_financials` (and, in practice matches, the company KB) make it CASCADE while keeping append-only journal entries. When an item touches this, confirm with `company_tool kb_search` and update the outdated test to the authoritative behaviour.
- pnpm 10 skips the Prisma postinstall: run `pnpm prisma generate` after install.
- Playwright is already a devDependency and its browsers are installed: in a CommonJS script under `answers/<ID>/evidence/`, use `require(path.join(<matchRoot>/src, 'node_modules/playwright')).chromium`. Do not install anything.
- `pnpm test` creates and migrates the test database itself (`tests/global-setup.ts`).
- Local app login for UI checks: seed credentials come from `ADMIN_EMAIL`/`ADMIN_PASSWORD` (see `prisma/seed.ts`). These are the local app's own demo accounts, not contest secrets.
- Challenge folders often ship loaders/check runners (`challenge/<ID>-*.mjs`, `prisma/seed-*.ts`) and an answer schema `challenge/<ID>-submit.schema.json`: run them, and validate the answer against the schema.
