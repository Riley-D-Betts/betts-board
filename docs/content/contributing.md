# Contributing

Issues and pull requests are welcome. This page covers getting a dev
environment running, the architecture rule that keeps the codebase easy to
work in, and what the license asks of you.

## Development setup

You need Node and npm — no Docker required for development:

```bash
npm install
npm run dev          # http://localhost:3000
```

The dev server runs the same full stack as production: one Nuxt/Nitro
server, no separate backend.

The checks:

```bash
npm test             # unit tests (recurrence/DST, parsers, aggregation, ICS…)
npm run lint
npm run typecheck
npm run db:generate  # regenerate migrations after editing server/db/schema
```

## The architecture: vertical slices

Every feature is a vertical slice. Its Vue components, API routes, service
logic, DB schema, and validation each live in a per-feature folder:

- `app/components/<feature>/` — Vue components
- `server/api/<feature>/` — thin routes: validate → call service → return
- `server/services/<feature>/` — all business logic
- `server/db/schema/<feature>.ts` — tables
- `shared/schemas/<feature>.ts` — zod contracts

Adding a feature means adding folders, not untangling existing code. Two
rules with no exceptions:

- All recurrence math flows through the DST-safe engine in
  `server/services/calendar/recurrence.ts` — never import `rrule` anywhere
  else. Imported ICS feeds share the same expansion pipeline as local
  events.
- Business logic lives in `server/services/`, not in routes, so it stays
  unit-testable without HTTP.

The full conventions — auth helpers, date handling, testing patterns — are
in [CLAUDE.md](../../CLAUDE.md).

## Pull requests

Before opening a PR:

```bash
npm test && npm run lint
```

and keep the change inside its feature slice. New behavior around
recurrence, parsing, or aggregation should come with unit tests — that is
where the existing suite is concentrated.

## What the AGPL means for your changes

Betts Board is licensed [AGPL-3.0](../../LICENSE). In plain terms: you can
use it, modify it, and self-host it freely, for your family or anyone
else's. The one obligation with teeth concerns network use — if you run a
**modified** version as a service for other people, you must offer those
people your modified source. Running an unmodified copy for your own
household asks nothing of you. If that obligation doesn't fit what you are
building, the right move is to contribute the change upstream — which is
rather the point.
