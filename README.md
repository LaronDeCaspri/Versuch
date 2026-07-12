# Compliance & Maintenance Records Platform (KSA)

Record-keeping for facility-management and MEP contractors in Saudi Arabia. The one
job it exists to do: when an inspector or auditor asks *"prove this fire pump was
tested on schedule for the last 24 months,"* produce that proof in under a minute — in
Arabic, with certificates attached.

Arabic is the primary language (RTL-first). All dates are computed in `Asia/Riyadh`;
Gregorian is canonical and Um al-Qura Hijri is shown alongside.

## Monorepo layout

| Package | Purpose |
|---|---|
| `packages/core` | Pure domain logic: the §4 status engine, Riyadh/Hijri date math, asset-type fuzzy matcher. No I/O — framework-free and fully unit-tested. |
| `packages/db` | Prisma schema, migrations (incl. DB-level immutability triggers), seed. |
| `apps/api` | Fastify API: session auth, tenant scoping, asset register, record capture, file storage, PDF dossier, users, audit. |
| `apps/web` | React + Vite + Tailwind, RTL-first, typed i18n (Arabic source of truth), offline-capable record capture. |

## Core guarantees

- **Multi-tenant isolation** — every row carries `organizationId`; every query is scoped
  by org and, where relevant, by the caller's site access. Cross-tenant access is tested.
- **Immutable evidence** — `InspectionRecord` can never be updated, deleted, or truncated
  (enforced by PostgreSQL triggers, not just app code). A mistake is corrected only by
  *superseding* it with a new record and a mandatory reason; both survive.
- **Status is derived, never stored** — `OVERDUE / DUE / OK / NEVER_DONE` computed
  server-side. `NEVER_DONE` is its own category and is never collapsed into `OVERDUE`.
- **PDPL** — data stays in-Kingdom (configurable S3-compatible storage), self-hosted
  fonts (no CDN), no analytics, and access to records/files/dossiers is logged.

## Getting started

Prerequisites: Node ≥ 22, pnpm, PostgreSQL, and (for PDF export) a Chromium binary.

```bash
pnpm install

# Point the DB packages at your Postgres instance:
cp packages/db/.env.example packages/db/.env      # set DATABASE_URL
cp apps/api/.env.example    apps/api/.env          # set DATABASE_URL, SESSION_SECRET, storage, CHROMIUM_EXECUTABLE

pnpm --filter @cmp/db migrate       # apply migrations
pnpm --filter @cmp/db seed          # demo tenant + draft duties + sample assets

# Run
pnpm --filter @cmp/api dev          # API on :3000
pnpm --filter @cmp/web dev          # web on :5173 (proxies /api → :3000)
```

Demo login after seeding: `owner@demo.sa` / `owner-password`.

## Quality gates

```bash
pnpm -r typecheck    # strict TS across all packages (no any, no ts-ignore)
pnpm -r test         # Vitest: status engine, immutability, tenancy, import, records, dossier, i18n
pnpm -r build
```

Every §4 status rule and every §3 immutability rule has a test. The DB test suite runs
against a separate `compliance_test` database.

## Roles

`OWNER` (full + user admin) · `MANAGER` (assigned sites) · `TECHNICIAN` (view + submit
records for assigned sites) · `VIEWER` (read-only + dossier export — the client-facing role).

## Notes for production

- Set `STORAGE_DRIVER=s3` with an in-Kingdom, S3-compatible endpoint (see
  `apps/api/.env.example`). Certificates are restricted to PDF/PNG/JPEG.
- Run the API DB role as a non-superuser so the immutability triggers cannot be bypassed.
- Set `COOKIE_SECURE=true` behind HTTPS.
- The seeded `InspectionDuty` intervals/authorities are **drafts** for the domain expert
  to confirm; they are not legal advice.
