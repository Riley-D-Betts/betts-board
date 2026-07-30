# Contributing

Issues and pull requests are welcome.

## Getting set up

```bash
npm install
npm run dev          # http://localhost:3000
```

The dev server uses the same SQLite database and data directory logic as
production, so you get a working board on first run without provisioning
anything.

## Commands

```bash
npm test             # vitest — recurrence/DST, parsers, aggregation, ICS
npm run lint
npm run typecheck
npm run db:generate  # regenerate migrations after editing server/db/schema
```

Run `npm test && npm run lint` before opening a pull request.

## The architecture in brief

Every feature is a **vertical slice**. Its components, API routes, service logic,
database schema, and validation each live in a per-feature folder:

| Layer | Path |
| --- | --- |
| Vue components | `app/components/<feature>/` |
| Pages | `app/pages/` |
| API routes | `server/api/<feature>/` |
| Business logic | `server/services/<feature>/` |
| Tables | `server/db/schema/<feature>.ts` |
| Validation contracts | `shared/schemas/<feature>.ts` |

Adding a feature means adding folders, not untangling existing code. Keep your
changes inside their slice.

Routes stay thin — validate, call the service, return. The logic belongs in the
service, where it is unit-testable without HTTP.

Some things are shared infrastructure and should not be modified as part of a
feature: `nuxt.config.ts`, `package.json`, the migrations in `drizzle/`, the auth
middleware, layouts, and the database client.

### Details worth knowing before you start

- **All recurrence math flows through one DST-safe engine**
  (`server/services/calendar/recurrence.ts`). It is the only place `rrule` is
  imported. Imported ICS feeds share the same expansion pipeline as local events,
  so fix a recurrence bug once and both get it. Never call `rrule` directly.
- **Calendar dates are not timestamps.** All-day events, chore due dates, and
  meal-plan dates are `YYYY-MM-DD` strings and must never pass through a timezone
  conversion or a locale formatter.
- **Text for people and values for machines format differently.** Human-facing
  dates go through the locale-aware formatter; RRULE `UNTIL` values, iCal
  `DTSTART`, and `datetime-local` inputs go through the machine formatter, which
  pins the locale and numbering system. Getting this backwards emits non-Latin
  digits under some locales and produces `.ics` files nothing can parse.
- **New API routes must be registered** in the API docs registry, or the OpenAPI
  coverage test fails.
- **Navigation lives in one place** — `app/composables/useNavItems.ts` — and is
  projected into the desktop sidebar, the phone tabs, and the phone menu. Add
  destinations there, not in the layout.
- **Never use `dark:` variants inside `/tv/*`.** TV pages use an independent
  palette; the dark variant matches from an ancestor, so a light TV subtree under
  a dark `<html>` would pick them up anyway.
- **User-facing strings are translated.** They live in
  `i18n/locales/en/<feature>.json` and are referenced as `<feature>.<key>`. Use
  ICU plurals rather than inline conditionals. English, Spanish, and French all
  ship.

Fuller conventions, including the parts that are easy to get wrong, are in
[`CLAUDE.md`](../../CLAUDE.md).

## Testing

Vitest specs live in `tests/unit/`. Test services, not HTTP routes.

For anything that touches the database, build an in-memory database, run the
migrations against it, and hand it to the services — the helpers for this are
described in [`CLAUDE.md`](../../CLAUDE.md). Fixtures such as saved recipe HTML
and `.ics` files go in `tests/fixtures/`.

## Pull requests

- Tests and lint pass.
- Changes stay inside their feature slice.
- If you touched the database schema, the regenerated migration is committed.
- If you added a user-facing string, it is in the locale files rather than inline
  in a component.

## License

Betts Board is [AGPL-3.0](../../LICENSE). You are free to use, modify, and
self-host it.

The obligation the AGPL adds over the GPL is this: if you run a **modified**
version as a service that other people use over a network, you have to make your
modified source available to those users. Running it unmodified for your own
family — which is the whole point — asks nothing of you. Neither does modifying
it for your own household. It is only offering a modified version to others as a
service that triggers the requirement.

Contributions are accepted under the same license.
