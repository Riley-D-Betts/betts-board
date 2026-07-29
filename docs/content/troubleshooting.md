# Troubleshooting

The problems that actually come up, one section each. Most of them trace
back to a single cause: a feature that needs HTTPS being used over plain
HTTP.

## Push notifications are silent

Work through these in order:

1. **Is the board served over HTTPS?** Web Push requires a secure context;
   over plain HTTP the browser never registers for push at all. See
   [HTTPS and remote access](./https.md).
2. **Did the browser get permission?** Each device must grant notification
   permission when asked. If it was declined once, re-enable it in the
   browser's site settings — the prompt won't come back on its own.
3. **Are notifications turned on in the app?** Check under **Settings**.
4. **iPhone?** iOS only delivers web push to sites installed to the home
   screen — install the board first, then enable notifications from inside
   the installed app.

## The install prompt never appears

**Add to Home Screen** (PWA install) also requires a secure context. If
the board is already served over HTTPS and installing still doesn't work:

- The board may already be installed — check the home screen.
- Some browsers never volunteer an install banner; use the browser menu's
  **Add to Home Screen** or **Install** entry instead.

## The barcode scanner won't open the camera

Browsers only expose the camera to secure contexts, so the pantry's
scanner needs HTTPS — see [HTTPS and remote access](./https.md). If HTTPS
is in place, check the browser's camera permission for the site.

## A calendar feed isn't importing

- Make sure the URL is an actual **iCal feed** — usually ending in `.ics`,
  or labelled "iCal" or "subscribe" on the school site — not a link to a
  calendar web page. Pasting an HTML page's URL imports nothing.
- Feeds refresh periodically rather than instantly, so a brand-new event
  on the school calendar can take a while to show up on the board.

## The container won't start

- **Port already bound** — something else on the host owns port 3000.
  Change the host side of the port mapping in
  [docker-compose.yml](../../docker-compose.yml) (for example
  `"8080:3000"`) and run `docker compose up -d` again.
- **Read the logs** — `docker compose logs betts-board` shows what the
  boot tripped over.
- **Volume permissions** — the container runs as a non-root `betts` user.
  The shipped named volume handles this for you, but if you swapped it for
  a bind mount, the host directory must be writable by the container user.
- **Health** — `docker compose ps` shows the health state; the container
  probes its own `/api/health` endpoint every 30 seconds.

## You forgot the household password

Not a lockout — there is a built-in reset that takes one container
restart. Follow
[Reset the password](./backup-restore.md#reset-the-password).
