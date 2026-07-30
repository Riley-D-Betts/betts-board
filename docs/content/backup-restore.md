# Backup & restore

## What lives in the volume

Everything the board owns is in one named volume, `betts-data`, mounted at
`/data`:

| Path | What it is |
| --- | --- |
| `betts.db` | The SQLite database — calendar, chores, recipes, meal plans, lists, profiles, settings |
| `uploads/` | Photos and recipe images |
| `.session-secret` | The key that seals session cookies |
| `.finance-key` | Present only if you use Money; decrypts stored bank credentials |

There is no second database and no external state. Copy that volume and you have
copied the board.

## Backup

```bash
# Excludes the cookie-sealing secret on purpose — see below
docker compose stop betts-board
docker run --rm -v betts-board_betts-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/betts-backup.tar.gz -C /data --exclude=./.session-secret .
docker compose start betts-board
```

Stopping the container first means SQLite is not mid-write when the tarball is
made. The board is down for the few seconds the `tar` takes.

The volume name is prefixed with the Compose project name, which defaults to the
directory you cloned into. If you renamed that directory, run
`docker volume ls` and use the name you actually see.

### Why the `--exclude`

`.session-secret` is the key that seals session cookies. It is generated on first
boot and reused forever, so a backup containing it lets anyone holding that
backup mint a cookie the *live* board accepts — no password needed, from anywhere
the board is reachable.

Backups get copied to laptops and cloud drives. The running board's login key
should not ride along. Leaving it out costs nothing: a restored install generates
a fresh one automatically, and everyone simply unlocks once with the household
password.

### The backup is still sensitive

It contains every photo, the whole calendar, and — if you use Money —
`.finance-key`, which decrypts your stored bank credentials. That file has to
stay in the backup: restore without it and you will be asked to reconnect the
bank, though Money still works and your history is intact.

So store the tarball somewhere you would be willing to store your family's
records, and encrypt it if it leaves the house.

## Restore

Into a fresh install:

```bash
docker run --rm -v betts-board_betts-data:/data -v "$PWD":/backup alpine \
  tar xzf /backup/betts-backup.tar.gz -C /data
docker compose up -d
```

The container generates a new `.session-secret` on boot, so everyone unlocks once
with the household password. Migrations run automatically, which means a backup
from an older version restores cleanly into a newer image.

## Scheduled backups

A cron line on the host is enough. This one keeps a dated tarball every night at
half past two:

```bash
30 2 * * * cd /srv/betts-board && docker compose stop betts-board && docker run --rm -v betts-board_betts-data:/data -v /srv/backups:/backup alpine tar czf /backup/betts-$(date +\%F).tar.gz -C /data --exclude=./.session-secret . && docker compose start betts-board
```

Note the escaped `\%F` — cron treats a bare `%` as a newline. Point the backup
directory at something that leaves the house, and prune old tarballs on whatever
schedule suits you.

## Reset the password

Forgotten the household password? Start one boot with `BETTS_RESET_PASSWORD=1`
and the unlock screen lets you set a new one.

```yaml
services:
  betts-board:
    environment:
      BETTS_RESET_PASSWORD: "1"
```

```bash
docker compose up -d
```

It clears the password once and then refuses to act again until you remove the
variable, so a copy left in `docker-compose.yml` cannot quietly reopen the board
on every restart. Remove it anyway once you are back in — the log says so too.

## Reset a Money PIN

Same pattern, different variable: `BETTS_RESET_FINANCE_PIN=1` clears every Money
PIN on the next boot. Bank connections and history are untouched, and whoever
sets a PIN first afterwards becomes the Money owner.

This needs access to the server itself, which is the point — Money's PIN is
meant to hold against someone standing at the tablet, and the escape hatch
should require more than that. Remove the variable once you are back in.

## About the unlock rate limit

Repeated wrong passwords slow the unlock screen down. After ten consecutive
failures — counted household-wide, across every device together, so guessing from
many addresses buys nothing — the board refuses unlock attempts for a minute,
escalating to at most fifteen.

It never locks permanently, and one correct password clears it. The counter lives
in the data volume, so restarting the container does not reset it.
