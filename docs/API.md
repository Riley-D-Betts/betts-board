# Betts Board public API

Every screen in the app talks to these same endpoints — anything the board can
do, an API client can do too.

## Authentication

Create a key in **Settings → API access** (admin only). The token (`bb_…`) is
shown exactly once; only its hash is stored. Send it on every request:

```
Authorization: Bearer bb_your_token_here
```

- A key **bound to a profile** acts as that family member: its requests can use
  every route that member could, and actions (completing chores, adding notes)
  are attributed to them. A key bound to an **admin** profile can also manage
  settings-level routes (feeds, profiles, API keys).
- An **unbound** key is read-mostly: it can only call routes that don't need an
  acting profile (marked *unlocked* below). Routes marked *profile* return
  `403 No acting profile`.
- Revoked keys, and keys bound to an archived profile, get `401 Invalid API key`.

## Base URL

All paths below are relative to your board's origin, e.g.
`https://board.example.com`. JSON in, JSON out (`Content-Type: application/json`
on requests with a body).

## Errors

Standard HTTP status codes with a human-readable `statusMessage`:
`400` invalid input (zod validation), `401` missing/invalid auth, `403` not
allowed for this key/role, `404` not found, `409` setup required.

## Conventions

- IDs are UUID strings.
- Instants (timed events) are **epoch milliseconds**; calendar dates (all-day
  events, chore due dates, meal-plan dates) are **`YYYY-MM-DD` strings** in the
  household's local calendar — never timezone-converted.
- Date-range windows are half-open: `start` inclusive, `end` exclusive.
- Recurrence rules are bare RRULE bodies (`FREQ=WEEKLY;BYDAY=MO` — no `DTSTART`).

## Calendar & events

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/calendar` | unlocked | query `start`, `end` (epoch ms, end exclusive), optional `profileIds` (comma-separated) — returns expanded occurrences (events + feed events) |
| POST | `/api/events` | profile | `title`, `isAllDay`, timed: `startAt`/`endAt` (ms) or all-day: `startDate`/`endDate`, `timezone`, optional `description`, `location`, `rrule`, `reminderMinutes[]`, `color`, `attendeeProfileIds[]` |
| GET | `/api/events/:id` | profile | series detail (attendees, exception count, source feed) |
| PATCH | `/api/events/:id` | profile | `scope` (`all`\|`this`\|`future`), `occurrenceStart` (ms, required for `this`/`future`), `changes` (partial event fields). Feed events are read-only (403) |
| DELETE | `/api/events/:id` | profile | `scope`, `occurrenceStart` — same scoping as PATCH |

## Chores

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/chores` | unlocked | chore definitions |
| POST | `/api/chores` | profile (adult) | `title`, `startDate` (YYYY-MM-DD), `assigneeProfileIds[]`, optional `rrule`, `dueTime` (HH:MM), `points`, `emoji`, `description`, `recurrenceEnd` |
| PATCH | `/api/chores/:id` | profile (adult) | partial chore fields + `archived` |
| DELETE | `/api/chores/:id` | profile (adult) | archives the chore |
| GET | `/api/chores/board` | unlocked | query `start`, `end` (YYYY-MM-DD, end exclusive) — expanded per-assignee instances |
| POST | `/api/chores/:id/complete` | profile | `dueDate` (YYYY-MM-DD), `profileId` (the assignee). Kids may only complete their own |
| DELETE | `/api/chores/:id/complete` | profile | same body — undoes a completion |
| GET | `/api/chores/leaderboard` | unlocked | query `period` = `week`\|`month`\|`all` |

## Recipes

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/recipes` | unlocked | query `q`, `tag`, `sort` = `recent`\|`rating`\|`title` |
| POST | `/api/recipes` | profile | `title`, optional `description`, `sourceUrl`, `prepMinutes`, `cookMinutes`, `totalMinutes`, `servings`, `steps[]`, `tags[]`, `ingredients[]` (`{ raw, quantity?, unit?, name?, note? }`) |
| POST | `/api/recipes/import` | profile | `url` — scrapes the recipe page |
| GET | `/api/recipes/:id` | unlocked | full recipe with ingredients, ratings, notes |
| PATCH | `/api/recipes/:id` | profile | partial recipe fields |
| DELETE | `/api/recipes/:id` | profile | |
| PUT | `/api/recipes/:id/rating` | profile | `rating` (1–5) — the acting profile's rating |
| POST | `/api/recipes/:id/notes` | profile | `body` |
| DELETE | `/api/recipes/:id/notes/:noteId` | profile | own notes; admins any |

## Meal plan

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/meal-plan` | unlocked | query `start`, `end` (YYYY-MM-DD, end exclusive) |
| POST | `/api/meal-plan/entries` | profile | `date`, `slot` (`breakfast`\|`lunch`\|`dinner`\|`snack`), exactly one of `recipeId` / `freeText`, optional `servingsOverride` |
| PATCH | `/api/meal-plan/entries/:id` | profile | partial entry fields |
| DELETE | `/api/meal-plan/entries/:id` | profile | |
| GET | `/api/meal-plan/entries/:id/ingredients` | unlocked | scaled ingredient list for a recipe-backed entry |

## Shopping lists

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/shopping-lists` | unlocked | lists with unchecked counts |
| POST | `/api/shopping-lists` | profile | `name`, optional `isDefault` |
| GET | `/api/shopping-lists/:id` | unlocked | list with items |
| PATCH | `/api/shopping-lists/:id` | profile | `name`, `isDefault` |
| DELETE | `/api/shopping-lists/:id` | profile | |
| POST | `/api/shopping-lists/:id/items` | profile | `name` (quick-add parses "2 lbs chicken"), optional `displayQuantity`, `quantity`, `unit`, `category` |
| PATCH | `/api/shopping-lists/:id/items/:itemId` | profile | partial item fields + `checked`, `sortOrder` |
| DELETE | `/api/shopping-lists/:id/items/:itemId` | profile | |
| POST | `/api/shopping-lists/:id/clear-checked` | profile | `toPantry` (bool) — optionally move checked items into the pantry |
| POST | `/api/shopping-lists/:id/items/from-recipe` | profile | `recipeId`, `ingredientIds[]`, optional `scale`. Use `default` as `:id` for the default list |
| POST | `/api/shopping-lists/generate` | profile | `start`, `end` (YYYY-MM-DD), optional `listId` (default list when omitted), `ignorePantry` — builds a list from the meal plan |

## Pantry & barcodes

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/pantry` | unlocked | query `q` (name filter) |
| POST | `/api/pantry` | profile | `name`, optional `quantity`, `unit`, `category`, `barcode` — upserts by normalized name |
| PATCH | `/api/pantry/:id` | profile | partial item fields |
| DELETE | `/api/pantry/:id` | profile | |
| GET | `/api/barcode/:code` | unlocked | product lookup (6–14 digits; Open Food Facts + local cache) |
| POST | `/api/barcode` | profile | `barcode`, `productName`, optional `brand` — remember a manual name for an unknown code |

## Photos & slideshow

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/photos` | unlocked | query `cursor` (last id of previous page), `limit` (≤100) |
| POST | `/api/photos` | profile | `multipart/form-data` — one or more image files, ≤25 MB each |
| PATCH | `/api/photos/:id` | profile | `inSlideshow` (bool) |
| DELETE | `/api/photos/:id` | profile | |
| GET | `/api/slideshow` | unlocked | shuffled slideshow manifest + display settings |

Image URLs in responses are session-gated `/uploads/…` paths — fetch them with
the same `Authorization` header.

## Weather

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/weather` | unlocked | cached forecast for the household location; `404` until a location is configured in Settings |

## Calendar feeds (ICS subscriptions)

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/feeds` | unlocked | |
| POST | `/api/feeds` | admin | `name`, `url`, optional `color`, `fetchIntervalMinutes` (15–1440) — fetches immediately |
| PATCH | `/api/feeds/:id` | admin | partial fields + `enabled` |
| DELETE | `/api/feeds/:id` | admin | also removes the feed's imported events |
| POST | `/api/feeds/:id/refresh` | admin | re-fetch now |

## Rewards

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/rewards` | unlocked | `{ rewards, balances, recent }` — catalog, star balances, recent redemptions |
| POST | `/api/rewards` | profile (adult) | `title`, `cost` (stars), optional `emoji`, `description`, `sortOrder` |
| PATCH | `/api/rewards/:id` | profile (adult) | partial fields + `archived` |
| DELETE | `/api/rewards/:id` | profile (adult) | archives the reward |
| POST | `/api/rewards/:id/redeem` | profile | optional `profileId` (defaults to the acting profile; kids only themselves) |

## API keys (admin)

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/api-keys` | admin | list keys (no hashes, no tokens) |
| POST | `/api/api-keys` | admin | `name`, optional `profileId` — response includes the one-time `token` |
| DELETE | `/api/api-keys/:id` | admin | revoke |

## Examples

Set up once:

```bash
BOARD=https://board.example.com
TOKEN=bb_your_token_here
```

List today's calendar occurrences (window is epoch-ms, end exclusive):

```bash
START=$(date -d 'today 00:00' +%s)000
END=$(date -d 'tomorrow 00:00' +%s)000
curl -H "Authorization: Bearer $TOKEN" "$BOARD/api/calendar?start=$START&end=$END"
```

Add a shopping item (quick-add parses quantity and unit from the name; needs a
profile-bound key):

```bash
curl -X POST "$BOARD/api/shopping-lists/<listId>/items" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "2 lbs chicken" }'
```

Complete a chore for today (find `choreId` and the assignee `profileId` via
`GET /api/chores/board`; needs a profile-bound key):

```bash
curl -X POST "$BOARD/api/chores/<choreId>/complete" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "dueDate": "2026-07-22", "profileId": "<profileId>" }'
```
