# BIRCH

BIRCH is an internal organization-chart application built with SvelteKit, TypeScript, Microsoft SQL Server, and Microsoft Entra ID.

## Current Status

The current app already supports:
- Entra sign-in and session-backed access control
- chart creation, switching, and default selection
- chart membership and role management
- manager-controlled chart naming, active state, and placeholder theme customization
- role-tier onboarding slides
- an interactive org-chart canvas on `/`

The current canvas supports draggable nodes, connector-based links, user assignment UI, pinning, pan/zoom, and edit mode controls.

Important limitation:
- the org-chart canvas is currently frontend state only
- node layout, connections, and node-level assignments are not yet persisted end-to-end in the database

## Product Vocabulary

Current product terms in the codebase:
- `Chart`: an access-scoped organization context
- `Organization Chart`: the main visual workspace
- `Node`: a draggable chart card
- `Connection`: a directional line between nodes
- `Member`, `Maintainer`, `Manager`: fixed chart roles

Some files still use legacy `chart` variable names internally. That is naming debt, not the intended product language.

## Main Routes

- `/`: org-chart workspace, chart switching, onboarding, and admin tooling
- `/setup`: first-time chart creation for bootstrap managers
- `/unauthorized`: access-gated fallback page
- `/auth/login`, `/auth/callback`, `/auth/error`: Entra auth flow

## Backend Capabilities

Current backend-backed features:
- session storage in `dbo.UserSessions`
- user profile upsert into `dbo.Users`
- chart membership and role resolution
- active chart per session
- default chart per user
- chart theme customization
- chart user lookup and role management
- onboarding role acknowledgement

Current backend gap:
- no persisted org-chart model yet for nodes, edges, coordinates, or per-node assignments

## API Surface

Chart management:
- `POST /api/charts`
- `GET /api/charts/memberships`
- `POST /api/charts/active`
- `POST /api/charts/default`
- `POST /api/charts/state`
- `POST /api/charts/customization`

Chart users:
- `GET /api/chart/users`
- `POST /api/chart/users`
- `PATCH /api/chart/users/:userOid`

Onboarding:
- `GET /api/onboarding/slides`
- `PATCH /api/onboarding/role`

Internal jobs:
- `POST /api/internal/jobs/scheduled-reminders`

## Project Structure

- `src/routes/`: pages and API routes
- `src/lib/components/`: shared UI components
- `src/lib/server/`: auth, DB, access, onboarding, and Graph helpers
- `db/`: schema and seed files
- `static/onboarding/`: file-backed onboarding content

## Local Development

Install and run:

```bash
yarn install
yarn dev
```

Quality checks:

```bash
yarn check
yarn lint
yarn test:unit
```

If you are using the parent Docker/scripts setup:

```bash
../scripts/StartDev.sh
../scripts/StopDev.sh
../scripts/Status.sh
```

Apply schema:

```bash
/bin/bash -lc "set -a; source ../.env.dev; set +a; ../scripts/SqlRun.sh dev birch < db/schema.sql"
```

## Notes For Ongoing Work

If you are extending the backend next, the most important missing piece is a real persistence model for the org-chart canvas that matches the existing frontend behavior.
