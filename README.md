# Betts Board

A self-hosted family organizer for the kitchen tablet, the TV, and everyone's
phones. One Docker container, one data volume, no accounts with big tech.

**Features**

- 📅 **Family calendar** — month/week/day/agenda views, color-coded per person,
  recurring events (daily/weekly/monthly/quarterly/yearly/custom) with proper
  "edit this / this and future / all" handling
- ✅ **Chores** — assign to family members, recurring schedules, points, streaks,
  and a leaderboard
- 🍳 **Recipes** — paste a link and the recipe is parsed and saved locally
  (ingredients, steps, photo), then rate it, note tweaks, and edit freely
- 🗓️ **Meal planning** — plan the week's meals from your recipe box
- 🛒 **Shopping lists** — generated from the meal plan with smart quantity
  merging, aisle grouping, and fast in-store check-off
- 🥫 **Pantry** — track what you have (scan barcodes with your phone camera);
  shopping generation skips what's already in the pantry
- 🖼️ **Photo slideshow** — upload family photos; idle devices become a photo
  frame with clock, weather, and today's agenda
- 📡 **Calendar feeds** — subscribe to school/sports iCal feeds; subscribe your
  phone to the family calendar
- 🌤️ **Weather** — Open-Meteo, no API key needed
- 🔔 **Push notifications** — event reminders and chore nudges (requires HTTPS)
- 📺 **TV mode** — big-type dashboard and slideshow for a browser on the TV

## Quick start

```bash
git clone <this repo> betts-board && cd betts-board
docker compose up -d --build
```

Open `http://your-server:3000` and follow the setup wizard: household name,
shared password, your town (for weather), and a profile for each family member.

That's it. The database, uploaded photos, and recipe images all live in the
`betts-data` volume.

### Requirements

- Docker + Docker Compose on any Linux box (a Raspberry Pi 4/5 works fine)
- Optional but recommended: HTTPS via a reverse proxy (see below)

## HTTPS

Push notifications, installing the app to a phone home screen (PWA), and the
camera barcode scanner all require a secure context (HTTPS). Two easy paths:

1. **Caddy sidecar** — uncomment the `caddy` service in `docker-compose.yml`
   and set your domain. Caddy fetches and renews certificates automatically.
2. **Existing reverse proxy** — point Traefik / Nginx Proxy Manager / Caddy at
   port 3000.

LAN-only without a domain? [Tailscale](https://tailscale.com) gives every
device a secure HTTPS-capable address with zero certificate fuss, or use
Caddy's internal CA.

Everything except push/PWA-install/camera works fine over plain HTTP.

## Everyday use

- **Phones**: open the site, then "Add to Home Screen" — it installs as an app.
- **Kitchen tablet**: sign in once (sessions last 90 days), then flip on
  *Settings → This device → Use as wall display* so it becomes a photo frame
  when idle.
- **TV**: open `http://your-server:3000/tv` in the TV browser for the big-type
  dashboard, or `/tv/slideshow` to go straight to photos.
- **School calendar**: *Settings → Calendar feeds → Add* with the iCal URL from
  the school website.
- **Your phone's calendar app**: subscribe to the URL shown under *Settings →
  Calendar feeds → Subscribe on your phone*.

## Backup & restore

Everything lives in one volume: the SQLite database and the `uploads/` folder.

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

## Forgot the household password?

```bash
BETTS_RESET_PASSWORD=1 docker compose up -d   # or uncomment it in compose
```

On the next load the setup screen reopens in password-reset mode. Remove the
variable afterward.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `TZ` | `UTC` | Container timezone (set it to your home timezone) |
| `BETTS_DATA_DIR` | `/data` | Where the database and uploads live |
| `NUXT_SESSION_PASSWORD` | auto-generated | Cookie-sealing secret; auto-created and persisted in the data volume |
| `BETTS_RESET_PASSWORD` | unset | Set to `1` for one boot to reset the household password |
| `PORT` | `3000` | HTTP port inside the container |

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests (recurrence engine, parsers, aggregation, ICS)
npm run lint
npm run typecheck
npm run db:generate  # regenerate migrations after editing server/db/schema
```

Architecture notes for contributors live in [CLAUDE.md](./CLAUDE.md) — the short
version: every feature is a vertical slice (components / API routes / service /
schema / validation each in a per-feature folder), SQLite via Drizzle with
migrations applied automatically on boot, and all recurrence math goes through
`server/services/calendar/recurrence.ts`.
