# BIRCH - Agent Onboarding

## Purpose
BIRCH (Business Identity, Roles, and Chain-of-command Hub) is a hierarchy-first internal application evolving into a personnel hierarchy platform.

Core goals:
- Keep hierarchy-scoped access and settings in a database-first model.
- Preserve backend-first authorization and role enforcement.
- Deliver intuitive visualization tooling for non-technical users.
- Support reusable components and composition links as the primary domain model.

## Product Direction (Target State)
- Render clickable components in `2D`, `2.5D`, and `3D`.
- Allow hierarchical drill-down until leaf components.
- Support optional warehouse mapping via component `ItemNumber`.
- Support both standalone component rendering and composited child rendering.
- Provide a composite layout/keyframe editor for exploded-view animations.

Rendering decisions:
- `PNG` is supported for 2D/2.5D visuals.
- `STEP` is the authoring/source format for 3D.
- For performance, STEP should be converted server-side into a browser runtime mesh format (glTF/GLB) and cached.
- `2.5D` means 2D canvas composition with z-order and parallax.

Coloring decisions:
- Whole-component tinting is required.
- Composite mode must still include a component-owned visual portion that can be tinted.
- Visible subcomponents render with their own tint values.

## Stack and Runtime
- Framework: `SvelteKit` + TypeScript.
- Backend DB: Microsoft SQL Server (Docker container).
- Auth: Microsoft Entra ID (OIDC + PKCE + certificate-based client assertion).
- Session storage: SQL table `dbo.UserSessions`.
- Reverse proxy: `nginx` in Docker compose.

## Access Model
Fixed role catalog (`dbo.Roles`):
- `Member`: baseline read/interact access for assigned hierarchies.
- `Maintainer`: full hierarchy/component editing (structure, assets, layout, keyframes, mappings, user management below manager level).
- `Manager`: maintainer access + hierarchy governance actions.

Manager-only capabilities:
- Set user permissions to `Manager`.
- Change hierarchy theme colors.
- Change hierarchy name.
- Deactivate hierarchy.
- Create new hierarchies.

Bootstrap model for first-time initialization:
- Env var `BOOTSTRAP_MANAGER_OIDS` contains allowed OIDs.
- Matching users are tracked in `dbo.BootstrapManagers`.
- Bootstrap managers can access `/setup` when they have bootstrap rights and no hierarchy access yet.

## Current Route-Level Behavior
Auth/guard logic is in `src/hooks.server.ts`.

Public paths:
- `/auth/login`
- `/auth/callback`
- `/auth/error`
- `/favicon.ico`

Special prefixes:
- `/api/internal/jobs/*`: bypasses app-level auth guard (network-restricted by nginx/docker setup).
- `/api/dev/*`: bypasses redirect gating checks, but still requires a valid session.

Protected flow (non-dev API routes):
- No valid session: redirect to `/auth/login`.
- Bootstrap user with no hierarchy access: redirect to `/setup`.
- User with no access: redirect to `/unauthorized`.
- User with access visiting `/unauthorized`: redirect to `/`.
- Non-bootstrap user visiting `/setup`: redirect to `/`.

Primary routes:
- `/`: viewer-first app shell + hierarchy switching/customization + tools modal.
- `/setup`: bootstrap first-hierarchy creation.
- `/unauthorized`: access-gated messaging page.
- `/auth/login`, `/auth/callback`, `/auth/error`: Entra auth flow.

## Session and Identity
Auth/session implementation: `src/lib/server/auth.ts`.

Important details:
- Session cookie key: `app_session`.
- Session records are stored in `dbo.UserSessions`.
- `UserSessions` includes `ActiveHierarchyId` (current hierarchy context per session).
- On login/session read, user profile is upserted into `dbo.Users`.

Per-session active hierarchy:
- Read via `getActiveHierarchyId(...)`.
- Updated via `setActiveHierarchyForSession(...)`.

Access-token usage:
- Session access token is reused for Graph lookups (user search) in hierarchy user add flows.

## Database Structure (Current)
Schema source of truth: `db/schema.sql`.

Primary domain tables:
- `dbo.Users`
- `dbo.Hierarchies`
- `dbo.Roles`
- `dbo.HierarchyUsers`
- `dbo.Components`
- `dbo.ComponentLinks`

Supporting tables:
- `dbo.BootstrapManagers`
- `dbo.UserSessions`

Model highlights:
- Soft-delete pattern via `IsActive`, `DeletedAt`, `DeletedBy` across core tables.
- Hierarchy-scoped unique names for components (`UX_Components_Hierarchy_Name_Active`).
- Active unique hierarchy names (`UX_Hierarchies_Name_Active`).
- Role assignment uniqueness per hierarchy/user (`UX_HierarchyUsers_Hierarchy_User_Active`).
- `ComponentLinks` supports reusable parent/child composition with:
  - `InstanceCount` and `SortOrder`
  - no self-reference check
  - recursion-prevention trigger: `dbo.TR_ComponentLinks_PreventRecursion`

Theme data:
- `dbo.Hierarchies.PlaceholderThemeJson` stores the current placeholder theme payload and is JSON-constrained.

Planned model extensions:
- Per-component render mode (`Auto`, `Standalone`, `Composite`) and effective-mode resolution.
- Component asset metadata for PNG and STEP source assets.
- Converted 3D runtime artifact references (glTF/GLB) for fast browser rendering.
- Per-child transform/layout records with full position/rotation/scale.
- Keyframe records (cap at 4 per child for v1).
- Optional component `ItemNumber` mapping for live warehouse lookup.

## UX and Editing Direction
- App should remain viewer-first and visually clean.
- Editing actions should be non-intrusive and launched in explicit modals.
- Composite mode should provide arrangement and keyframe editing in a dedicated editor modal.
- Desktop-first UX; maintain reasonable responsiveness but mobile editing is not a v1 requirement.

## Onboarding Model
Onboarding content is file-backed in `static/onboarding` and served by role tier.

Implementation:
- Server helpers: `src/lib/server/onboarding.ts`
- API:
  - `GET /api/onboarding/slides`
  - `PATCH /api/onboarding/role`

Role tiers:
- `Member` = 1
- `Maintainer` = 2
- `Manager` = 3

`dbo.Users.OnboardingRole` tracks the highest acknowledged tier (0-3).

## Current API Surface
Hierarchy selection/customization:
- `POST /api/hierarchies`
- `GET /api/hierarchies/memberships`
- `POST /api/hierarchies/active`
- `POST /api/hierarchies/default`
- `POST /api/hierarchies/state`
- `POST /api/hierarchies/customization`

Hierarchy user management:
- `GET /api/hierarchy/users`
- `POST /api/hierarchy/users`
- `PATCH /api/hierarchy/users/:userOid`

Onboarding:
- `GET /api/onboarding/slides`
- `PATCH /api/onboarding/role`

Internal jobs:
- `POST /api/internal/jobs/scheduled-reminders`

## First-Time Setup Behavior
First-time setup implementation: `src/routes/setup/+page.server.ts`.

Current behavior:
- Bootstrap manager creates the first hierarchy by name.
- New hierarchy gets default placeholder theme JSON.
- Creator is auto-assigned `Manager` role in `dbo.HierarchyUsers`.
- Creator's `DefaultHierarchyId` is set if null.
- Session `ActiveHierarchyId` is set to the new hierarchy.

## Local Development Runbook
Project layout assumptions:
- Compose/scripts root is parent directory (`../` from this workspace).
- App source root is this directory (`BIRCH`).

Key scripts (from `../scripts`):
- `StartDev.sh`
- `StopDev.sh`
- `SqlRun.sh`
- `Status.sh`
- `DevLogs.sh`

Typical commands:
```bash
../scripts/StartDev.sh
../scripts/StopDev.sh
```

Apply schema:
```bash
/bin/bash -lc "set -a; source ../.env.dev; set +a; ../scripts/SqlRun.sh dev birch < db/schema.sql"
```

Seed data:
```bash
/bin/bash -lc "set -a; source ../.env.dev; set +a; ../scripts/SqlRun.sh dev birch < db/seed.sql"
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
- `ENTRA_TENANT_ID`
- `ENTRA_CLIENT_ID`
- `ENTRA_REDIRECT_URI`
- `ENTRA_CLIENT_CERT_PRIVATE_KEY_PATH`
- `ENTRA_CLIENT_CERT_PUBLIC_CERT_PATH`
- `APP_SESSION_SECRET`
- `BOOTSTRAP_MANAGER_OIDS`
- `DEV_CONSOLE_ALLOWED_OIDS` (optional, dev-only)

`BOOTSTRAP_MANAGER_OIDS` delimiter support:
- comma, semicolon, or whitespace.

## Agent Notes / Guardrails
- Treat `db/schema.sql` as authoritative for data model changes.
- Preserve soft-delete behavior unless explicitly instructed otherwise.
- Keep access checks backend-driven; do not rely on frontend-only gating.
- Use Entra OID (`UserOid`) as stable identity key; do not key identity by email.
- Keep hierarchy access scoped via `HierarchyUsers` + role resolution logic.
- Keep the primary UI viewer-first; place editing in explicit modal flows.
- Preserve role boundaries: maintainer edits structure/components; manager handles hierarchy governance.
- For 3D performance, prefer server-side STEP conversion + cached runtime artifacts over raw STEP rendering in browser.

## Package Manager
- In this environment, npm is not available for package operations.
- Prefer yarn for install/check/lint/test workflows.
