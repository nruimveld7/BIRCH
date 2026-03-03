# Equipment Lifecycle Manager (ELM)

SvelteKit + TypeScript starter shell for the Equipment Lifecycle Manager project.

## Current State

This repository has been reset from the prior Shift Schedule implementation to provide a clean starting point:

- No authentication flow.
- No legacy schedule APIs.
- Minimal backend route: `GET /api/health`.
- Minimal SQL baseline in `db/schema.sql`.
- Prior Shift Schedule components/utilities are preserved under `legacy/shift-schedule/` for optional reuse during migration.

## Development

Run from this directory:

```bash
yarn dev
```

Quality checks:

```bash
yarn check
yarn lint
yarn test:unit
```

## Database

Apply baseline schema:

```bash
/bin/bash -lc "set -a; source ../.env.dev; set +a; ../scripts/SqlRun.sh dev elm < db/schema.sql"
```

Run starter seed script:

```bash
/bin/bash -lc "set -a; source ../.env.dev; set +a; ../scripts/SqlRun.sh dev elm < db/seed.sql"
```

## Next Build Targets

- Define ELM domain model and tables (equipment, lifecycle states, events, ownership, and audits).
- Reintroduce auth and authorization when access rules are ready.
- Build API routes around finalized domain use-cases.
