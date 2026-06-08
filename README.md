# Aligned

A social shared-calendar app for friends/family to find their **free overlapping
time** and plan meetups. Web + native mobile.

Full design + decisions: [`docs/DESIGN.md`](docs/DESIGN.md).

## Monorepo layout

```text
aligned/
  apps/
    web/    @aligned/web   — Next.js (App Router, TS, Sass Modules)
    api/    @aligned/api   — Express + Drizzle + Postgres backend
    mobile/                — Expo / React Native (added in Phase 4)
  packages/
    core/   @aligned/core  — shared TS: types, API client, free-slot algorithm
  docker-compose.yml       — local Postgres 17
```

(Deploy/orchestration lives in a SEPARATE `aligned-deploy` repo — see DESIGN.md #3.)

## Tech

- **Web:** Next.js 16 (App Router, React Server Components), TypeScript, Sass Modules,
  mobile-first.
- **API:** Node + Express, **Drizzle ORM** on **PostgreSQL 17**.
- **DB:** Postgres with `tstzrange` + a GiST index for the free-slot overlap query.
- **Monorepo:** pnpm workspaces (`core` imported directly, no publishing).

## Getting started (local dev)

Prereqs: Node ≥ 20, pnpm, Docker.

```sh
pnpm install            # install everything across the workspace
pnpm db:up              # start local Postgres (docker, host port 5433)

cp apps/api/.env.example apps/api/.env        # already present in dev

pnpm --filter @aligned/api db:migrate         # create the tables
pnpm dev:api            # backend  → http://localhost:4000/health
pnpm dev:web            # frontend → http://localhost:3000
```

Stop the DB with `pnpm db:down` (data persists in a named volume).

## Database

Schema lives in [`apps/api/src/db/schema.ts`](apps/api/src/db/schema.ts) — 7 tables:
`users · friendships · blocks · calendars · events · calendar_shares · messages`.

```sh
pnpm --filter @aligned/api db:generate   # generate a migration after editing schema.ts
pnpm --filter @aligned/api db:migrate    # apply migrations
pnpm --filter @aligned/api db:studio     # browse the DB in Drizzle Studio
```

## Status

Phase 1 scaffold complete: monorepo + Postgres + the full schema (migrated). Next:
build features — auth → profiles → friends → calendars → events → the free-slot merge
(see `docs/DESIGN.md` "Phase 1 — step order").
