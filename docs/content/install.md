# Install

Betts Board ships as a single Docker image built from the repository. This
page takes you from `git clone` to a working board: the quick start, what
first boot does on its own, the setup wizard, and how to update later.

## Prerequisites

- A Linux box, NAS, or Raspberry Pi 4/5 running **Docker** with the
  **Docker Compose plugin** (`docker compose`, not the legacy
  `docker-compose`).
- Network access from the family's devices to that machine.

Nothing else — no external database, no API keys.

## Quick start

```bash
git clone https://github.com/Riley-D-Betts/betts-board.git
cd betts-board
docker compose up -d --build
```

The first build compiles native modules, so it takes a few minutes; later
rebuilds are much faster. When it finishes, open:

```text
http://your-server:3000
```

## What first boot does

Before the setup wizard appears, the container handles its own plumbing:

- **Database migrations** ship with the image and are applied automatically
  on every boot — the first boot creates the schema, and later updates
  apply their changes the same way.
- **VAPID keys** for Web Push notifications are provisioned automatically.
- A **session secret** (`NUXT_SESSION_PASSWORD`) is generated and persisted
  in the data volume if you didn't set one, so sign-ins survive container
  recreation.

The container also reports its own health: `docker compose ps` shows
`healthy` once the server answers on `/api/health`.

## The setup wizard

Your first visit walks you through four things:

1. A **household name** for the board.
2. **One shared password** — the whole family uses it; there are no
   per-person accounts.
3. **Your town**, used for the weather display (Open-Meteo, no API key
   needed).
4. **A profile for each family member** — profiles drive calendar colors,
   chore assignments, and the leaderboard.

That's the whole install.

## Ports

The server listens on port `3000` inside the container, and the shipped
[docker-compose.yml](../../docker-compose.yml) publishes it as port `3000`
on the host. To serve on a different host port, change the left-hand side
of the mapping:

```yaml
ports:
  - "8080:3000"
```

The container-side port is controlled by the `PORT` environment variable
and is best left at `3000` — see
[Configuration](./configuration.md#environment-variables).

## The data volume

Everything the board owns lives in one named volume, `betts-data`, mounted
at `/data`:

- `/data/betts.db` — the SQLite database
- `/data/uploads/…` — family photos and recipe images

Backing up the board means copying this one volume — see
[Backup and restore](./backup-restore.md).

## Updating

```bash
cd betts-board
git pull
docker compose up -d --build
```

Migrations run automatically on boot, so a schema change in an update
applies itself the next time the container starts.

## Next steps

- [HTTPS and remote access](./https.md) — required for push notifications,
  home-screen install, and the barcode scanner.
- [Everyday use](./everyday-use.md) — set up the phones, the wall tablet,
  and the TV.
