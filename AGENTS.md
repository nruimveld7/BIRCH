# BIRCH - Agent Onboarding

## Purpose
BIRCH is an internal chart and organization-chart application.

The current product surface is centered on:
- Microsoft Entra sign-in and session-backed access control
- chart membership and role management
- chart switching, default selection, and manager customization
- a visual org-chart canvas for arranging nodes and drawing connections

## Current Product State
The current frontend is an organization-chart workspace, not a component/CAD application.

What exists today:
- `/` renders a chart-aware org-chart canvas
- users can switch charts and set a default chart
- managers can create charts, rename them, toggle active state, and edit placeholder theme colors
- maintainers and managers can open edit mode on the canvas
- the active chart's users can be listed, searched through Microsoft Graph, added, and role-edited
- onboarding slides are shown based on role tier

Important current limitation:
- node and connection editing in `src/routes/+page.svelte` is currently client-side UI state
- there is no end-to-end database persistence yet for org-chart nodes, edges, node assignments, canvas layout, or pinned state

## Current Domain Vocabulary
Use the current frontend language:
- `Chart`: an access-scoped org context
- `Organization Chart`: the visual canvas on `/`
- `Node`: a draggable chart card on the canvas
- `Connection`: a directional line between node connectors
- `Member`, `Maintainer`, `Manager`: fixed chart roles

Avoid introducing unrelated domain terms such as component/composite/STEP unless the user explicitly reintroduces them.

Note:
- some frontend files still use legacy `chart*` variable names internally, especially in chart-management modals
- treat those as naming debt, not as product terminology

## Stack and Runtime
- Framework: `SvelteKit` + TypeScript
- Database: Microsoft SQL Server
- Auth: Microsoft Entra ID with server-side session storage
- Session table: `dbo.UserSessions`
- Reverse proxy/runtime: Docker + `nginx`

## Access Model
Fixed role catalog:
- `Member`: view allowed charts and use the viewer shell
- `Maintainer`: member access plus edit mode and chart user management below manager level
- `Manager`: maintainer access plus chart governance actions

Manager-only behavior currently exposed by the UI/backend:
- create new charts
- assign the `Manager` role
- rename a chart
- change chart placeholder theme colors
- activate/deactivate a chart

Bootstrap behavior:
- `BOOTSTRAP_MANAGER_OIDS` grants first-time setup access
- bootstrap managers without chart access are routed to `/setup`

## Current Route-Level Behavior
Auth gating lives in `src/hooks.server.ts`.

Public routes:
- `/auth/login`
- `/auth/callback`
- `/auth/error`
- `/favicon.ico`

Protected routes:
- `/`
- `/setup`
- `/unauthorized`
- all non-internal API routes

Current flow:
- no session: redirect to `/auth/login`
- bootstrap user with no chart access: redirect to `/setup`
- authenticated user with no chart access: redirect to `/unauthorized`
- authenticated user with chart access: land on `/`

## Frontend Behavior
Primary page: `src/routes/+page.svelte`

Current canvas capabilities:
- drag, rename, resize, pin, and delete nodes
- create connector-to-connector links between nodes
- assign selected users to a node via `UserSearchCombobox`
- pan, zoom, momentum scroll, keyboard navigation, and camera focus
- toggle edit mode based on role

Current persistence reality:
- chart memberships, role context, onboarding state, and theme settings are backed by the server
- node graph state is not yet loaded from or saved to the backend

Chart management UI:
- `src/lib/components/ChartsModal.svelte`
- `src/lib/components/ChartToolsModal.svelte`

Onboarding UI:
- `src/lib/components/OnboardingTourModal.svelte`
- file-backed slide content under `static/onboarding`

Theme behavior:
- theme preference (`system` / `dark` / `light`) is stored in browser `localStorage`
- manager-edited placeholder colors are stored server-side on the chart

## Server/Data Model State
The backend currently supports:
- user/session storage
- chart creation and activation
- chart membership and role resolution
- default chart selection
- chart placeholder theme customization
- onboarding acknowledgement by role tier

The backend does not yet provide an org-chart persistence model for:
- chart nodes
- chart edges
- per-node assigned users
- canvas coordinates and dimensions
- pinned node state

Treat that gap as real when designing schema or APIs.

## Current API Surface
Chart management:
- `POST /api/charts`
- `GET /api/charts/memberships`
- `POST /api/charts/active`
- `POST /api/charts/default`
- `POST /api/charts/state`
- `POST /api/charts/customization`

Chart user management:
- `GET /api/chart/users`
- `POST /api/chart/users`
- `PATCH /api/chart/users/:userOid`

Onboarding:
- `GET /api/onboarding/slides`
- `PATCH /api/onboarding/role`

## First-Time Setup
Implementation:
- `src/routes/setup/+page.svelte`
- `src/routes/setup/+page.server.ts`

Current behavior:
- bootstrap manager creates the first chart by name
- new chart gets a default placeholder theme payload
- creator is assigned `Manager`
- default chart and active session chart are set

## Local Development
Project layout:
- app root: this directory
- compose/scripts root: parent directory

Typical commands:
```bash
yarn install
yarn dev
yarn check
yarn lint
yarn test:unit
```

Environment-specific scripts from the parent repo:
```bash
../scripts/StartDev.sh
../scripts/StopDev.sh
../scripts/Status.sh
```

Apply schema:
```bash
/bin/bash -lc "set -a; source ../.env.dev; set +a; ../scripts/SqlRun.sh dev birch < db/schema.sql"
```

## Environment Variables
Operationally important values are defined outside this directory and include:
- `SA_PASSWORD`
- `MSSQL_HOST`
- `MSSQL_PORT`
- `MSSQL_USER`
- `MSSQL_PASSWORD`
- `MSSQL_DATABASE`
- `MSSQL_ENCRYPT`
- `MSSQL_TRUST_SERVER_CERT`
- `ENTRA_TENANT_ID`
- `ENTRA_CLIENT_ID`
- `ENTRA_REDIRECT_URI`
- `ENTRA_CLIENT_CERT_PRIVATE_KEY_PATH`
- `ENTRA_CLIENT_CERT_PUBLIC_CERT_PATH`
- `APP_SESSION_SECRET`
- `BOOTSTRAP_MANAGER_OIDS`
- `DEV_CONSOLE_ALLOWED_OIDS`

## Agent Guardrails
- Base product descriptions on the current code, especially `src/routes/+page.svelte`, not on stale copied documentation
- Treat `db/schema.sql` as the schema source of truth, but verify that it matches the actual product before extending it
- Keep authorization backend-driven
- Use Entra OID (`UserOid`) as the stable identity key
- Keep chart scope explicit in any new persistence model
- Preserve the current role boundaries in both UI and API behavior
- When adding org-chart persistence, model the actual frontend concepts: nodes, connections, assignments, and layout
- Do not describe the app as a component/composite/3D system unless the user explicitly changes direction

## Package Manager
- Prefer `yarn`
- Do not assume `npm` is available for package-management workflows in this environment
