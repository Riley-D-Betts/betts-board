# Backup and restore

One of the nicer consequences of the one-container design: the entire
board is a single Docker volume. Back that up and you have everything.

## What lives in the volume

The `betts-data` volume is mounted at `/data` inside the container and
holds:

- `/data/betts.db` — the SQLite database: calendar, chores, recipes, meal
  plans, shopping lists, pantry, settings
- `/data/uploads/…` — family photos and recipe images

There is no other state. Configuration you set in the compose file lives
in the compose file; everything else is in the volume.

## Back up

Stop the app briefly so the database is quiet, tar the volume, start it
again:

```bash
docker compose stop betts-board
docker run --rm -v betts-board_betts-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/betts-backup.tar.gz -C /data .
docker compose start betts-board
```

This leaves `betts-backup.tar.gz` in your current directory. The volume's
full name is prefixed with the compose project name (the folder name), so
if you cloned into a folder not named `betts-board`, check
`docker volume ls` and adjust `betts-board_betts-data` to match.

## Restore

Restore into a fresh install: clone the repository, unpack the backup into
the volume, then start the stack:

```bash
docker run --rm -v betts-board_betts-data:/data -v "$PWD":/backup alpine \
  tar xzf /backup/betts-backup.tar.gz -C /data
docker compose up -d
```

The board comes back exactly as it was — household, profiles, calendar,
photos, everything.

## Scheduled backups

Put the backup commands in a script, for example
`/home/you/backup-betts.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /home/you/betts-board
docker compose stop betts-board
docker run --rm -v betts-board_betts-data:/data -v /home/you/backups:/backup alpine \
  tar czf "/backup/betts-$(date +%F).tar.gz" -C /data .
docker compose start betts-board
```

Then run it weekly with cron, at an hour nobody is checking chores:

```text
15 3 * * 1 /home/you/backup-betts.sh
```

The board is down only for the seconds the tar takes. Prune old archives
however you prefer.

## Reset the password

Forgot the household password? You don't need a backup for this. Give the
container one boot with `BETTS_RESET_PASSWORD=1` — the line is already in
[docker-compose.yml](../../docker-compose.yml), commented out:

```yaml
environment:
  TZ: America/Boise
  BETTS_RESET_PASSWORD: "1"
```

Uncomment it and recreate the container:

```bash
docker compose up -d
```

The unlock screen now lets you set a new password. Once you have, comment
the line back out and run `docker compose up -d` again so the reset window
closes.
