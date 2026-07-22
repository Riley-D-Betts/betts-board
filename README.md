# Betts Board

**A self-hosted family organizer for the kitchen tablet, the TV, and everyone's
phones.** One Docker container, one data volume, no subscriptions, no accounts
with big tech — your family's calendar, chores, recipes, and photos stay on
your own server.

![Dashboard](docs/screenshots/dashboard.png)

| Calendar | Chores on a phone |
| --- | --- |
| ![Calendar](docs/screenshots/calendar.png) | ![Chores on mobile](docs/screenshots/mobile-chores.png) |

## Features

- 📅 **Family calendar** — month/week/day/agenda views, color-coded per person,
  recurring events (daily/weekly/monthly/quarterly/yearly/custom) with proper
  "edit this / this and future / all" handling
- ✅ **Chores** — assign to family members, recurring schedules, points,
  streaks, and a leaderboard the kids will actually check
- 🍳 **Recipes** — paste a link and the recipe is parsed and saved locally
  (ingredients, steps, photo); rate it, note tweaks ("double the sauce next
  time"), and edit freely
- 🗓️ **Meal planning** — plan the week's meals from your recipe box, sorted by
  what the family rated best
- 🛒 **Shopping lists** — generated from the meal plan with smart quantity
  merging, aisle grouping, and fast in-store check-off
- 🥫 **Pantry** — track what you have (scan barcodes with your phone camera);
  shopping generation skips what's already in the pantry
- 🖼️ **Photo slideshow** — upload family photos; idle wall displays become a
  photo frame with clock, weather, and today's agenda
- 📡 **Calendar feeds** — subscribe to school/sports iCal feeds; subscribe your
  phone's calendar app to the family board
- 🌤️ **Weather** — Open-Meteo, no API key, °F or °C
- 🔔 **Push notifications** — event reminders and chore nudges (requires HTTPS)
- 📺 **TV mode** — big-type dashboard and slideshow for any TV browser

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
# Backup
docker compose stop betts-board
docker run --rm -v betts-board_betts-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/betts-backup.tar.gz -C /data .
docker compose start betts-board

# Restore into a fresh install
docker run --rm -v betts-board_betts-data:/data -v "$PWD":/backup alpine \
  tar xzf /backup/betts-backup.tar.gz -C /data
docker compose up -d
```

Forgot the household password? Start one boot with `BETTS_RESET_PASSWORD=1`
and the unlock screen lets you set a new one.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `TZ` | `UTC` | Container timezone — set it to your home timezone |
| `BETTS_DATA_DIR` | `/data` | Where the database and uploads live |
| `NUXT_SESSION_PASSWORD` | auto-generated | Cookie-sealing secret; created and persisted in the data volume automatically |
| `BETTS_RESET_PASSWORD` | unset | Set to `1` for one boot to reset the household password |
| `PORT` | `3000` | HTTP port inside the container |

Everything else — weather location, temperature unit, week start, slideshow
behavior, feeds, notifications — is configured in the app under **Settings**.

## Tech stack

Nuxt 4 full-stack (one Nitro server, no separate backend) · SQLite via Drizzle
ORM with migrations applied automatically on boot · Nuxt UI v4 + Tailwind ·
`rrule` for RFC 5545 recurrence · sharp for image processing · Web Push with
auto-provisioned VAPID keys · installable PWA.

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

## License

[AGPL-3.0](./LICENSE) — free to use, modify, and self-host; if you run a
modified version as a service for others, you share your changes too.
