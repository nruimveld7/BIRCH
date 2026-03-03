# Equipment Lifecycle Manager (ELM) - Agent Onboarding

## Purpose
This repository is the new ELM application baseline.

Current goals:
- Keep a minimal, stable shell while ELM requirements are finalized.
- Define ELM-specific domain tables incrementally in SQL first.
- Build routes and API behavior around finalized use-cases.

## Stack and Runtime
- Framework: `SvelteKit` + TypeScript.
- Backend DB: Microsoft SQL Server (Docker container).
- Package manager: `yarn`.

## Current Application State
Primary active routes:
- `/`: starter shell page.
- `/api/health`: minimal health endpoint.

Not currently implemented:
- Authentication and session handling.
- Role-based access checks.
- ELM business workflows and domain APIs.

## Repository Layout Notes
- Active app code lives under `src/`.
- `legacy/shift-schedule/` is intentionally retained as reference code for possible reuse during migration.
- Treat files under `legacy/` as read-only reference unless explicitly migrating pieces into active code.

## Database
Schema source of truth: `db/schema.sql`.

Current baseline:
- `dbo.SchemaInfo` table only.
- Version row `SchemaVersion = 1` inserted by baseline script.

Seed script:
- `db/seed.sql` currently validates/readouts baseline schema state only.

## Local Development Runbook
Project layout assumptions:
- Compose root is parent directory (`../` from this workspace).
- App source root is this directory (`ELM`).

Typical commands:
```bash
yarn dev
yarn check
yarn lint
yarn test:unit
```

Apply schema:
```bash
/bin/bash -lc "set -a; source ../.env.dev; set +a; ../scripts/SqlRun.sh dev elm < db/schema.sql"
```

Run seed script:
```bash
/bin/bash -lc "set -a; source ../.env.dev; set +a; ../scripts/SqlRun.sh dev elm < db/seed.sql"
```

## Environment Variables (Operationally Important)
Defined in compose/env files outside this directory:
- `SA_PASSWORD`
- `MSSQL_HOST`
- `MSSQL_PORT`
- `MSSQL_USER`
- `MSSQL_PASSWORD`
- `MSSQL_DATABASE`
- `MSSQL_ENCRYPT`
- `MSSQL_TRUST_SERVER_CERT`

Only add auth-related variables once auth implementation is reintroduced.

## Agent Notes / Guardrails
- Keep `db/schema.sql` authoritative for data model changes.
- Prefer additive, migration-friendly SQL changes.
- Do not reintroduce Shift Schedule domain concepts into active ELM code unless explicitly requested.
- Keep `legacy/` available until final cutover cleanup.

## Package Manager
- In this environment, npm is not accessible.
- Prefer yarn for package operations.
