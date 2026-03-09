# BIRCH

Business Identity, Roles, and Chain-of-command Hub

Configurable platform for creating and managing personnel hierarchies in an intuitive way.

## Status

This project is in early scaffolding. Core personnel hierarchy management workflows are still being built.

## Vision

- Build and manage personnel hierarchies visually.
- Support clear role-based permissions and governance.
- Make chain-of-command relationships easy to understand and maintain.
- Keep the UI intuitive for non-technical users.

## Tech Stack

- `SvelteKit`
- `TypeScript`
- `Microsoft SQL Server`
- `Microsoft Entra ID` authentication
- `Docker` + `nginx` for local/container runtime

## Local Development

From this repo:

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

## Database

Schema and seed files live in:

- `db/schema.sql`
- `db/seed.sql`

Apply schema/seed using your local SQL workflow/scripts for this environment.

## Project Structure

- `src/` application code
- `src/routes/` route handlers and pages
- `src/lib/` shared client/server modules
- `db/` SQL schema and seed data
- `docs/` product and technical specs

## Documentation Roadmap

As implementation progresses, expand this README with:

- Setup prerequisites and env vars
- Auth flow details
- Role matrix and access rules
- API endpoint documentation
- Deployment/runbook notes
