# Install

## Before you start

You need Docker and the Docker Compose plugin on the machine that will host the
board. Any Linux box, NAS, old laptop, or Raspberry Pi 4/5 will do.

Pick a machine that stays on. The board runs scheduled work while it is up —
calendar feeds refresh every 15 minutes, notifications dispatch every minute,
and bank connections sync on their own interval — so a host that sleeps is a
board that quietly stops keeping up.

## Quick start

```bash
git clone https://github.com/Riley-D-Betts/betts-board.git
cd betts-board
docker compose up -d --build
```

The first build compiles native modules from source, so give it a few minutes
on a Pi. Subsequent builds reuse the cache.

Then open `http://your-server:3000`.

## What first boot does

Before you see anything, the container sets itself up:

- **Generates the cookie-sealing secret.** If you have not set
  `NUXT_SESSION_PASSWORD`, the entrypoint creates `.session-secret` in the data
  volume and reuses it forever after, so sessions survive the container being
  recreated. Treat that file like a password — see
  [Backup & restore](./backup-restore.md).
- **Applies database migrations.** They ship inside the image and run on boot,
  so an upgrade never needs a manual migration step.
- **Provisions VAPID keys** for push notifications, once, automatically.

A healthcheck polls `/api/health` every 30 seconds after a 15-second grace
period, so `docker compose ps` tells you honestly whether the board is up.

## The setup wizard

The first page you land on is the wizard. It asks for four things:

1. **Household name** — what the board calls itself.
2. **One shared password.** This is the boundary around the whole board:
   everyone in the house uses the same one, and it is the only password there
   is. Sessions last 90 days, so the kitchen tablet is unlocked once and then
   left alone.
3. **Your town**, for the weather forecast. Open-Meteo needs no API key.
4. **A profile for each family member.** Profiles are how the board attributes
   events, chores, and completions — not logins. Switching between them is a
   tap with no password, which is deliberate for a shared tablet.

That is the whole install. Everything after this is configured in the app under
**Settings**, covered in [Configuration](./configuration.md).

## Ports

The container listens on port 3000, and `docker-compose.yml` publishes it as
`3000:3000`. To serve it on a different host port, change the left-hand number:

```yaml
services:
  betts-board:
    ports:
      - "8080:3000"
```

Leave the right-hand number alone unless you also set `PORT` in the
environment — that is the port inside the container, and the healthcheck expects
3000.

## The data volume

Everything the board owns lives in one named volume, `betts-data`, mounted at
`/data`:

- `betts.db` — the SQLite database: calendar, chores, recipes, meal plans,
  lists, profiles, settings
- `uploads/` — photos and recipe images
- `.session-secret` — the cookie-sealing key described above
- `.finance-key` — present only if you use Money; it decrypts stored bank
  credentials
- a downloaded Google Font, if you added one in Settings

Back up that volume and you have backed up the board. See
[Backup & restore](./backup-restore.md) for the commands, and read the note
about which of those files should and should not ride along in the tarball.

## Updating

```bash
git pull
docker compose up -d --build
```

Migrations run automatically on the new container's first boot. The data volume
is untouched by a rebuild.

If a change you expected is missing afterwards, check **Settings → About this
board** — it shows the version, the commit, and the build date, which tells you
whether the server was actually rebuilt. The same details are served at
`/api/health`.

## Next steps

- [HTTPS](./https.md) — needed for push notifications, installing to a phone's
  home screen, and the camera barcode scanner.
- [Everyday use](./everyday-use.md) — setting up the kitchen tablet, the TV, and
  everyone's phones.
