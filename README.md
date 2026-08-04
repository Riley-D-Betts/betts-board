# Betts Board

**A self-hosted family organizer for the kitchen tablet, the TV, and everyone's
phones.** One Docker container, one data volume, no subscriptions, no accounts
with big tech — your family's calendar, chores, recipes, and photos stay on
your own server.

**Docs:** the full install and usage guide lives at
[betts-board-site.pages.dev/docs](https://betts-board-site.pages.dev/docs).

![Dashboard](docs/screenshots/dashboard.png)

| Calendar | Chores on a phone |
| --- | --- |
| ![Calendar](docs/screenshots/calendar.png) | ![Chores on mobile](docs/screenshots/mobile-chores.png) |

## Features

- 📅 **Family calendar** — month/week/day/agenda views, color-coded per person,
  recurring events (daily/weekly/monthly/quarterly/yearly/custom) with proper
  "edit this / this and future / all" handling
- ✅ **Chores** — assign to family members, recurring schedules, points,
  streaks, and a leaderboard the kids will actually check; view the week by day
  or by person, and check-offs land with confetti and a streak callout
- ⭐ **Rewards store** — kids spend earned chore stars on parent-defined
  rewards; balances and history are tracked automatically
- 🍳 **Recipes** — paste a link and the recipe is parsed and saved locally
  (ingredients, steps, photo); rate it, note tweaks ("double the sauce next
  time"), and edit freely
- 🗓️ **Meal planning** — plan the week's meals from your recipe box, sorted by
  what the family rated best; assign who's cooking and a prep block sized to
  the recipe (+15 min padding) lands on their calendar, ending at mealtime
- 🛒 **Shopping lists** — generated from the meal plan with smart quantity
  merging, aisle grouping, and fast in-store check-off; or cherry-pick
  ingredients from any planned meal straight onto a list
- 🥫 **Pantry** — track what you have (scan barcodes with your phone camera);
  shopping generation skips what's already in the pantry
- 🎁 **Wish lists** — birthday and holiday lists per person, with links, rough
  prices, and a countdown to the date; everyone in the house can see them
- 🖼️ **Photo slideshow** — upload family photos; idle wall displays become a
  photo frame with clock, weather, and today's agenda
- 📡 **Calendar feeds** — subscribe to school/sports iCal feeds; subscribe your
  phone's calendar app to the family board
- 🌤️ **Weather** — Open-Meteo, no API key, °F or °C
- 🔔 **Push notifications** — event reminders and chore nudges (requires HTTPS)
- 📺 **TV mode** — big-type dashboard and slideshow for any TV browser, scaled
  to whatever resolution the set reports, and switching between light and dark
  automatically at sunrise and sunset
- 🎨 **Appearance** — household-wide font and accent colors, set separately for
  light and dark mode. Eight webfonts ship with the app, and you can add any
  Google Font by name — it's downloaded once and served from your own server
  afterwards, so no page view is ever reported to Google and it still works
  offline
- 🌐 **Languages** — the whole board speaks English, Spanish, or French, chosen
  once for the household in Settings. Dates, times, and money amounts follow the
  language too, and every translation is bundled and served from your own server,
  so nothing is fetched from a translation service and it all works offline
- 💰 **Money** — accounts, transactions (split a single receipt across
  categories), budgets, bills, savings goals, and a cash-flow forecast, behind
  its own PIN. Connect a bank through
  [SimpleFIN](https://beta-bridge.simplefin.org/) or import OFX/QFX/CSV
  statements. Deliberately never shown on the dashboard, the wall display, or
  the shared calendar — see [Money and privacy](#money-and-privacy)
- 🔌 **Public API** — token-authenticated REST API for Home Assistant, scripts,
  and anything else (see the [API reference](#api-reference) below); keys
  managed in Settings

## Quick start

Requires Docker + Docker Compose on any Linux box, NAS, or Raspberry Pi 4/5.

```bash
git clone https://github.com/Riley-D-Betts/betts-board.git
cd betts-board
docker compose up -d --build
```

Open `http://your-server:3000` and follow the setup wizard: household name,
one shared password, your town (for weather), and a profile for each family
member. That's the whole install — the database, uploaded photos, and recipe
images all live in the `betts-data` volume.

Full walkthrough — including the setup wizard and updating — in the
[install guide](https://betts-board-site.pages.dev/docs/install).

## HTTPS

Push notifications, installing to a phone home screen (PWA), and the camera
barcode scanner require a secure context (HTTPS). Everything else works over
plain HTTP on your LAN. Easy paths:

1. **Caddy sidecar** — uncomment the `caddy` service in `docker-compose.yml`
   and set your domain; certificates are automatic.
2. **Existing reverse proxy** — point Traefik / Nginx Proxy Manager / Caddy at
   port 3000.
3. **No domain?** [Tailscale](https://tailscale.com) gives every device a
   secure HTTPS-capable address with zero certificate fuss.

## Everyday use

- **Phones** — open the site → "Add to Home Screen"; it installs as an app.
- **Kitchen tablet** — sign in once (sessions last 90 days), flip on
  *Settings → This device → Use as wall display*, and it becomes a photo frame
  whenever it sits idle. Tap or press any key to get back to the board.
- **TV** — open `/tv` in the TV browser for the big-type dashboard, or
  `/tv/slideshow` to go straight to photos.
- **School calendar** — *Settings → Calendar feeds → Add* with the iCal URL.
- **Your phone's calendar app** — subscribe to the private URL under
  *Settings → Calendar feeds → Subscribe on your phone*.

## Backup & restore

Everything lives in one volume: the SQLite database plus the `uploads/` folder.

```bash
# Backup — excludes the cookie-sealing secret on purpose (see below)
docker compose stop betts-board
docker run --rm -v betts-board_betts-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/betts-backup.tar.gz -C /data --exclude=./.session-secret .
docker compose start betts-board

# Restore into a fresh install
docker run --rm -v betts-board_betts-data:/data -v "$PWD":/backup alpine \
  tar xzf /backup/betts-backup.tar.gz -C /data
docker compose up -d
```

**Why the `--exclude`.** The volume also holds `.session-secret`, the key that
seals session cookies. It's generated on first boot and reused forever, so a
backup containing it lets anyone holding that backup mint a cookie the *live*
board accepts — no password needed, from anywhere the board is reachable.
Backups get copied to laptops and cloud drives; the running board's login key
shouldn't ride along. Leaving it out costs nothing: a restored install
generates a fresh one automatically, and everyone simply unlocks once with the
household password.

**The backup is still sensitive.** It contains every photo, the whole calendar,
and — if you use Money — `.finance-key`, which decrypts your stored bank
credentials. That file has to stay in the backup (restore without it and you'll
be asked to reconnect the bank), so store the tarball somewhere you'd be
willing to store your family's records, and encrypt it if it leaves the house.

Forgot the household password? Start one boot with `BETTS_RESET_PASSWORD=1`
and the unlock screen lets you set a new one. It clears the password once and
then refuses to act again until you remove the variable, so leaving it in
`docker-compose.yml` can't quietly reopen the board on every restart — but do
remove it anyway; the log says so too.

Repeated wrong passwords slow the unlock screen down: after ten consecutive
failures — counted household-wide, from every device together, so that guessing
from many addresses buys nothing — the board refuses unlock attempts for a
minute, escalating to at most fifteen. It never locks permanently, and one
correct password clears it. The counter lives in the data volume, so restarting
the container does not reset it.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `TZ` | `UTC` | Container timezone — set it to your home timezone |
| `BETTS_DATA_DIR` | `/data` | Where the database and uploads live |
| `NUXT_SESSION_PASSWORD` | auto-generated | Cookie-sealing secret; created as `.session-secret` in the data volume on first boot and reused. Treat it like a password — see [Backup & restore](#backup--restore) |
| `BETTS_RESET_PASSWORD` | unset | Set to `1` to reset the household password. Acts on the **next boot only**: the board records that it ran and ignores the variable afterwards, so a copy left in `docker-compose.yml` can't reset the password on every restart. Remove it (or give it a different value) to arm it again |
| `BETTS_RESET_FINANCE_PIN` | unset | Set to `1` to clear every Money PIN. Bank connections and history are untouched; whoever sets a PIN first afterwards becomes the Money owner. Same one-shot arming as `BETTS_RESET_PASSWORD` |
| `BETTS_SIMPLEFIN_HOSTS` | `bridge.simplefin.org, beta-bridge.simplefin.org` | Comma-separated hosts the server may fetch bank data from — both of SimpleFIN's public bridges by default. Only change this if you run your own SimpleFIN bridge |
| `BETTS_SIMPLEFIN_DEBUG` | unset | Set to `1` to log every SimpleFIN request, the raw response, and what was made of it (`docker logs`, lines prefixed `[simplefin]`) — for diagnosing a sync that isn't bringing in what the bank shows. Credentials are scrubbed from every line, but the log will contain balances and transaction descriptions, so turn it off again once you're done |
| `BETTS_ALLOW_PRIVATE_FETCH_HOSTS` | unset | Comma-separated hosts on your own network that the board is allowed to fetch from — e.g. `nas.lan,192.168.1.10`. By default every outbound fetch the app makes on someone's behalf (recipe import, calendar feed, font download) refuses to connect to a private, loopback or link-local address, because otherwise anyone who can paste a link can make the board knock on your router, your NAS, your printer, or a cloud metadata endpoint and never see the reply. Subscribing to a calendar hosted on your **own** NAS is a legitimate reason to reopen exactly that one host. Matching is exact and per-host, so allowing the NAS does not allow the router. It is a variable rather than a setting in the app on purpose: this should cost a deliberate edit here, not a checkbox anyone with an admin session can tick |
| `NUXT_SESSION_COOKIE_SECURE` | `false` | Session cookies work over plain HTTP by default (LAN deployments). Set to `true` when serving behind HTTPS so the cookie is only ever sent encrypted |
| `BETTS_TRUSTED_PROXY` | unset | Set to `1` only when a reverse proxy **you control** is the only route to the container. It makes the unlock rate limit read the client address from the last `X-Forwarded-For` element instead of the socket. Leave it unset if the container is reachable directly — the header is client-writable, and trusting it would let an attacker pick their own rate-limit bucket |
| `PORT` | `3000` | HTTP port inside the container |

Everything else — weather location, temperature unit, week start, meal times,
default cook, appearance, language, slideshow behavior, feeds, notifications,
API keys — is configured in the app under **Settings**.

## Money and privacy

The Money section is the one part of Betts Board that isn't shared with the
whole house, so it works differently from everything else. This section says
exactly what it does and doesn't protect — please read it before connecting a
bank.

### Why it needs its own PIN

Everywhere else, the household password is the boundary: anyone who can unlock
the board is family, and family sees everything. That's the right model for
chores and dinner. It doesn't work for bank balances, because **switching
profiles takes no password** — anyone at the tablet can tap any profile,
including an admin one. So the "admin" role protects against accidents and
stray API keys, not against a person standing at the device.

Money therefore has a second, independent lock:

- Each person with access has their own **PIN** (6+ characters), separate from
  the household password.
- Unlocking lasts **15 minutes of activity**, with an 8-hour hard limit — not
  the 90 days the rest of the board uses.
- Switching profiles drops it — the unlock is ended on the server, not just
  hidden, so switching *back* doesn't bring it back either. Dad unlocking Money
  and walking away does not leave it unlocked for the next person at the
  tablet, whichever face they tap.
- Failed attempts are counted and shown to you next time you unlock, and
  repeated failures lock that profile out for 5 minutes, then an hour, then a
  day. The counter survives restarts.
- **API keys can never reach Money**, whatever profile they're bound to. A key
  lives in a Home Assistant config file and has no PIN; that's not a boundary
  that should reach bank data.
- **Settings → Money** lists every device that currently has Money unlocked,
  with a button to lock any of them.

Forgotten the PIN? Set `BETTS_RESET_FINANCE_PIN=1` and restart. That needs
access to the server itself, which is the point. It clears the PINs once and
then ignores the variable, so it can't keep handing Money to whoever sets a PIN
first after each restart — remove it from your environment once you're back in.

### Where Money never appears

By design, and verified by tests that fail the build if it stops being true:

- **Not on the dashboard.** No tile, not even a collapsed one.
- **Not on TV mode.** `/tv/*` pages run without an acting profile and are
  refused by the server outright.
- **Not on the shared calendar or the iCal feed.** Bills live only inside
  Money. The calendar export URL is handed to every unlocked client, so a bill
  on the family calendar would be a bill published to anyone holding that link.
- **Not in push notifications.** Notification text renders on a phone's lock
  screen, and "Chase connection failed" is a disclosure.
- The Money item is hidden from navigation entirely on devices flagged as a
  wall display.

### What the encryption does and doesn't protect

Connecting a bank stores a SimpleFIN access URL that contains live credentials
for reading your accounts. It's encrypted at rest with AES-256-GCM, using a key
generated on first use and stored at `${BETTS_DATA_DIR}/.finance-key`.

**This protects a stray copy of the database.** Copying `betts.db` is the
documented backup path (see [Backup & restore](#backup--restore)), and those
copies end up on laptops and in cloud drives. A copy of the database alone
reveals nothing.

**It does not protect against someone who has the server.** The key file lives
in the same volume as the database, so anyone who takes the whole volume, or
who gets into the container or the host, has both halves. Self-hosting can't do
better than that without asking you for a passphrase on every reboot, which
would also mean bank sync stops whenever nobody's looking at the screen. The
app says this plainly on screen rather than implying more.

If you back up the data volume, `.finance-key` is in it — treat that backup as
sensitive. If you restore `betts.db` **without** `.finance-key`, Money still
works and your history is intact; you'll be asked to reconnect the bank.

### Connecting a bank

Betts Board speaks [SimpleFIN](https://beta-bridge.simplefin.org/), which is a
read-only, paid bridge to most US and Canadian banks. You paste a setup token;
it's exchanged once, immediately, and never stored. The server will only ever
fetch from SimpleFIN's own bridge hosts (`bridge.simplefin.org` and
`beta-bridge.simplefin.org`; override with `BETTS_SIMPLEFIN_HOSTS`) over
HTTPS, refuses redirects, and refuses to fetch private or link-local addresses
— a setup token is a URL your server is asked to call, and that shouldn't be a
way to point it at your router.

Connections sync every 6 hours by default. A bank that fails backs off
exponentially rather than retrying every tick, and one bank having a bad day
never stops the others.

**No bank connection required.** Money works perfectly well with accounts you
keep by hand, or by importing OFX/QFX/CSV statements — likely duplicates are
always shown to you for review, never dropped silently, and any import can be
undone in one click.

## Tech stack

Nuxt 4 full-stack (one Nitro server, no separate backend) · SQLite via Drizzle
ORM with migrations applied automatically on boot · Nuxt UI v4 + Tailwind ·
`rrule` for RFC 5545 recurrence · sharp for image processing · Web Push with
auto-provisioned VAPID keys · vue-i18n with English, Spanish, and French, all
bundled and served locally · installable PWA.

Everything is served from your own server. The app makes no outbound requests
at page load — fonts, icons, and translations are all local — and the only
network calls it ever makes are ones you ask for: the weather forecast, recipe
imports, calendar-feed refreshes, barcode lookups, and a one-time font download.

## Development

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # unit tests (recurrence/DST, parsers, aggregation, ICS…)
npm run lint
npm run typecheck
npm run db:generate  # regenerate migrations after editing server/db/schema
```

Architecture notes live in [CLAUDE.md](./CLAUDE.md). The short version: every
feature is a **vertical slice** — its components, API routes, service logic,
DB schema, and validation each live in a per-feature folder — so adding a
feature means adding folders, not untangling existing code. All recurrence
math flows through one DST-safe engine
(`server/services/calendar/recurrence.ts`), and imported ICS feeds share the
same expansion pipeline as local events.

## Contributing

Issues and PRs welcome. Before opening a PR: `npm test && npm run lint`, and
keep changes inside their feature slice (see [CLAUDE.md](./CLAUDE.md)).

More detail in the
[contributing guide](https://betts-board-site.pages.dev/docs/contributing).

## License

[AGPL-3.0](./LICENSE) — free to use, modify, and self-host; if you run a
modified version as a service for others, you share your changes too.

## API reference

Every screen in the app talks to these same endpoints — anything the board can
do, an API client can do too.

Every board also serves its own interactive docs at `/docs` (works fully
offline), backed by a live OpenAPI 3.1 document at `/api/openapi.json` that is
generated from the same validation schemas the server enforces — so it can
never drift from reality.

### Authentication

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

### Base URL

All paths below are relative to your board's origin, e.g.
`https://board.example.com`. JSON in, JSON out (`Content-Type: application/json`
on requests with a body).

### Errors

Standard HTTP status codes with a human-readable `statusMessage`:
`400` invalid input (zod validation), `401` missing/invalid auth, `403` not
allowed for this key/role, `404` not found, `409` setup required.

### Conventions

- IDs are UUID strings.
- Instants (timed events) are **epoch milliseconds**; calendar dates (all-day
  events, chore due dates, meal-plan dates) are **`YYYY-MM-DD` strings** in the
  household's local calendar — never timezone-converted.
- Date-range windows are half-open: `start` inclusive, `end` exclusive.
- Recurrence rules are bare RRULE bodies (`FREQ=WEEKLY;BYDAY=MO` — no `DTSTART`).

### Calendar & events

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/calendar` | unlocked | query `start`, `end` (epoch ms, end exclusive), optional `profileIds` (comma-separated) — returns expanded occurrences (events + feed events) |
| POST | `/api/events` | profile | `title`, `isAllDay`, timed: `startAt`/`endAt` (ms) or all-day: `startDate`/`endDate`, `timezone`, optional `description`, `location`, `rrule`, `reminderMinutes[]`, `color`, `attendeeProfileIds[]` |
| GET | `/api/events/:id` | profile | series detail (attendees, exception count, source feed) |
| PATCH | `/api/events/:id` | profile | `scope` (`all`\|`this`\|`future`), `occurrenceStart` (ms, required for `this`/`future`), `changes` (partial event fields). Feed events are read-only (403) |
| DELETE | `/api/events/:id` | profile | `scope`, `occurrenceStart` — same scoping as PATCH |

### Chores

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

### Recipes

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

### Meal plan

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/meal-plan` | unlocked | query `start`, `end` (YYYY-MM-DD, end exclusive) |
| POST | `/api/meal-plan/entries` | profile | `date`, `slot` (`breakfast`\|`lunch`\|`dinner`\|`snack`), exactly one of `recipeId` / `freeText`, optional `servingsOverride` |
| PATCH | `/api/meal-plan/entries/:id` | profile | partial entry fields |
| DELETE | `/api/meal-plan/entries/:id` | profile | |
| GET | `/api/meal-plan/entries/:id/ingredients` | unlocked | scaled ingredient list for a recipe-backed entry |

### Shopping lists

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

### Pantry & barcodes

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/pantry` | unlocked | query `q` (name filter) |
| POST | `/api/pantry` | profile | `name`, optional `quantity`, `unit`, `category`, `barcode` — upserts by normalized name |
| PATCH | `/api/pantry/:id` | profile | partial item fields |
| DELETE | `/api/pantry/:id` | profile | |
| GET | `/api/barcode/:code` | unlocked | product lookup (6–14 digits; Open Food Facts + local cache) |
| POST | `/api/barcode` | profile | `barcode`, `productName`, optional `brand` — remember a manual name for an unknown code |

### Photos & slideshow

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/photos` | unlocked | query `cursor` (last id of previous page), `limit` (≤100) |
| POST | `/api/photos` | profile | `multipart/form-data` — one or more image files, ≤25 MB each |
| PATCH | `/api/photos/:id` | profile | `inSlideshow` (bool) |
| DELETE | `/api/photos/:id` | profile | deletes the photo and its files. Adults and admins may delete any photo; a kid may only delete one they uploaded themselves |
| GET | `/api/slideshow` | unlocked | shuffled slideshow manifest + display settings |

Image URLs in responses are session-gated `/uploads/…` paths — fetch them with
the same `Authorization` header.

### Weather

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/weather` | unlocked | cached forecast for the household location; `404` until a location is configured in Settings |

### Calendar feeds (ICS subscriptions)

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/feeds` | unlocked | |
| POST | `/api/feeds` | admin | `name`, `url`, optional `color`, `fetchIntervalMinutes` (15–1440) — fetches immediately |
| PATCH | `/api/feeds/:id` | admin | partial fields + `enabled` |
| DELETE | `/api/feeds/:id` | admin | also removes the feed's imported events |
| POST | `/api/feeds/:id/refresh` | admin | re-fetch now |

### Rewards

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/rewards` | unlocked | `{ rewards, balances, recent }` — catalog, star balances, recent redemptions |
| POST | `/api/rewards` | profile (adult) | `title`, `cost` (stars), optional `emoji`, `description`, `sortOrder` |
| PATCH | `/api/rewards/:id` | profile (adult) | partial fields + `archived` |
| DELETE | `/api/rewards/:id` | profile (adult) | archives the reward |
| POST | `/api/rewards/:id/redeem` | profile | optional `profileId` (defaults to the acting profile; kids only themselves) |

### API keys (admin)

| Method | Path | Auth | Body / query |
|---|---|---|---|
| GET | `/api/api-keys` | admin | list keys (no hashes, no tokens) |
| POST | `/api/api-keys` | admin | `name`, optional `profileId` — response includes the one-time `token` |
| DELETE | `/api/api-keys/:id` | admin | revoke |

### Examples

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
