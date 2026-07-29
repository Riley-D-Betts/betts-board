# Configuration

Betts Board keeps configuration in two places, and the split is simple:

- **Environment variables** cover the handful of things the container
  needs before the app is up — timezone, port, data path, secrets. You set
  them in the `environment:` block of
  [docker-compose.yml](../../docker-compose.yml), and they take effect on
  container start.
- **Settings**, inside the app, covers everything else — weather location,
  temperature unit, week start, slideshow behavior, calendar feeds,
  notifications.

If you are wondering where a knob lives: anything that changes how the
family uses the board is in Settings; anything that changes how the
container runs is an environment variable.

## Environment variables

| Env var | Default | Purpose |
| --- | --- | --- |
| `TZ` | `UTC` | Container timezone — set it to your home timezone |
| `BETTS_DATA_DIR` | `/data` | Where the database and uploads live |
| `NUXT_SESSION_PASSWORD` | auto-generated | Cookie-sealing secret; created and persisted in the data volume automatically |
| `BETTS_RESET_PASSWORD` | unset | Set to `1` for one boot to reset the household password |
| `PORT` | `3000` | HTTP port inside the container |

A sentence on each:

- **`TZ`** — the one variable everyone should set. The shipped compose
  file sets `TZ: America/Boise`; change it to your own zone so reminders,
  day boundaries, and the agenda line up with your kitchen clock.
- **`BETTS_DATA_DIR`** — where the SQLite database and uploads live inside
  the container. Leave it at `/data`; the compose file mounts the
  `betts-data` volume there.
- **`NUXT_SESSION_PASSWORD`** — the secret that seals session cookies. You
  don't need to set it: it is generated automatically and persisted in the
  data volume, so sessions survive container recreation.
- **`BETTS_RESET_PASSWORD`** — an escape hatch, not a setting. Set it to
  `1` for a single boot to reset a forgotten household password, then
  remove it. The walkthrough is in
  [Backup and restore](./backup-restore.md#reset-the-password).
- **`PORT`** — the port the server listens on *inside* the container. To
  change what the host exposes, change the compose port mapping instead —
  see [Install](./install.md#ports).

Set them in the compose file and recreate the container:

```yaml
services:
  betts-board:
    environment:
      TZ: Europe/London
```

```bash
docker compose up -d
```

## Settings in the app

Everything the family actually touches lives under **Settings** in the
app:

- **Weather** — the town you picked in the setup wizard, and the
  temperature unit (°F or °C). Weather comes from Open-Meteo and needs no
  API key.
- **Week start** — which day your calendar weeks begin on.
- **Slideshow** — how the idle photo frame behaves on wall displays.
- **Calendar feeds** — subscribe to school or sports iCal feeds, and get
  the private URL for subscribing your phone in the other direction.
  Details in [Everyday use](./everyday-use.md#calendar-feeds).
- **Notifications** — event reminders and chore nudges. These need the
  board served over HTTPS; see
  [HTTPS and remote access](./https.md).
- **This device** — per-device options such as **Use as wall display**,
  which turns that screen (and only that screen) into the idle photo
  frame.
