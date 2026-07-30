# Configuration

There are two places to configure Betts Board, and the split is deliberate.

**Environment variables** are set in `docker-compose.yml` and take effect when
the container starts. They cover things that must be settled before the app is
running, or that should cost a deliberate edit on the server rather than a
checkbox anyone with an admin session can tick.

**Settings**, in the app, covers everything else — and that is most of it.

## Environment variables

| Env var | Default | Purpose |
| --- | --- | --- |
| `TZ` | `UTC` | Container timezone. Set it to your home timezone; the shipped compose file uses `America/Boise` |
| `BETTS_DATA_DIR` | `/data` | Where the database and uploads live |
| `PORT` | `3000` | HTTP port inside the container. Change the published host port in `docker-compose.yml` instead unless you have a reason |
| `NUXT_SESSION_PASSWORD` | auto-generated | Cookie-sealing secret. Created as `.session-secret` in the data volume on first boot and reused, so sessions survive container recreation. Treat it like a password — see [Backup & restore](./backup-restore.md) |
| `NUXT_SESSION_COOKIE_SECURE` | `false` | Session cookies work over plain HTTP by default, for LAN deployments. Set to `true` when serving behind HTTPS so the cookie is only ever sent encrypted |
| `BETTS_RESET_PASSWORD` | unset | Set to `1` to reset the household password on the **next boot only**. See [Reset the password](./backup-restore.md#reset-the-password) |
| `BETTS_RESET_FINANCE_PIN` | unset | Set to `1` to clear every Money PIN. Bank connections and history are untouched; whoever sets a PIN first afterwards becomes the Money owner. Same one-shot arming as `BETTS_RESET_PASSWORD` |
| `BETTS_TRUSTED_PROXY` | unset | Set to `1` **only** when a reverse proxy you control is the sole route to the container. The unlock rate limit then reads the client address from the last `X-Forwarded-For` element instead of the socket. Leave it unset if the container is reachable directly — the header is client-writable, and an attacker who can pick their own rate-limit bucket has no rate limit at all |
| `BETTS_ALLOW_PRIVATE_FETCH_HOSTS` | unset | Comma-separated hosts on your own network the board may fetch from, e.g. `nas.lan,192.168.1.10`. See below |
| `BETTS_SIMPLEFIN_HOSTS` | `bridge.simplefin.org, beta-bridge.simplefin.org` | Comma-separated hosts the server may fetch bank data from. Only change this if you run your own SimpleFIN bridge |

### About the private-fetch guard

Every outbound fetch the board makes *on someone's behalf* — importing a recipe
from a pasted link, refreshing a calendar feed, downloading a Google Font —
refuses to connect to a private, loopback, or link-local address.

The reason: without that guard, anyone who can paste a link can make the board
knock on your router, your NAS, your printer, or a cloud metadata endpoint, and
they never even need to see the reply.

Subscribing to a calendar hosted on your **own** NAS is a legitimate reason to
reopen exactly one host, which is what `BETTS_ALLOW_PRIVATE_FETCH_HOSTS` is for.
Matching is exact and per-host, so allowing the NAS does not allow the router.

It is an environment variable rather than a setting in the app on purpose. This
should cost a deliberate edit on the server.

## Settings

Open **Settings** in the app. Sections marked *admin* only appear for admin
profiles.

### Household — *admin*

The household name, weather location, timezone, and the week's start day
(Sunday or Monday). Temperature is shown in Fahrenheit or Celsius everywhere on
the board.

**Meal times** set when each meal is eaten — breakfast, lunch, dinner, snack.
Cooking blocks placed on the calendar end at these times, sized to the recipe
plus fifteen minutes of padding. **Default cook** is pre-filled when planning a
meal and can be changed per meal; leave it on *No default* to be asked each
time.

### Language

The board language: English, Spanish, or French. It applies household-wide, and
dates, times, and amounts follow the language you pick. Translations are bundled
and served from your own server, so nothing is fetched from a translation
service and it works offline. Admin only to change.

### Family members — *admin*

Add, edit, and archive profiles, and set each person's role. See
[Everyday use](./everyday-use.md#profiles) for what roles actually gate.

### Appearance

Light or dark is a per-device choice, with *Auto* following the device setting.

The **font** and the **accent colors** are household-wide, set separately for
light and dark mode, and admin-only. Eight webfonts ship with the app. You can
also add any Google Font by name: it is downloaded once, stored on your server,
and served from there afterwards, so no page view is ever reported to Google and
it still works offline.

**TV mode theme** decides how `/tv` looks — following sunrise and sunset, or
pinned to always light or always dark. Household-wide, not per device.

### Slideshow

Minutes of idle time before the slideshow starts, seconds per photo, the
transition, and whether to show the clock, the weather, and today's agenda.
**Preview slideshow** shows the result without waiting for the idle timer.

### Calendar feeds — *admin*

Feeds in and the subscription URL out. Covered in
[Everyday use](./everyday-use.md#calendar-feeds-in).

### Notifications

**Notify on this device** subscribes the browser you are currently using, for the
acting profile. Needs HTTPS; if the section reports that push notifications are
unavailable, start with [HTTPS](./https.md).

### API access — *admin*

Create and revoke tokens for the REST API. The token is shown exactly once and
only its hash is stored.

A key bound to a profile acts as that family member. An unbound key is
read-mostly. API keys can never reach Money, whatever profile they are bound to.
The full endpoint reference is in
[`docs/API.md`](../../docs/API.md), and every board also serves interactive docs at
`/docs` backed by a live OpenAPI document at `/api/openapi.json`.

### This device

**Use as wall display** — per device. Starts the slideshow when this device sits
idle. Turn it on for the kitchen tablet or TV, leave it off for phones and
laptops.

### About this board

Version, commit, and build date. Worth checking after an update: if a change you
expected is not there, the build date tells you whether the server was actually
rebuilt. The same details are served at `/api/health`.

## Money

Money is configured from its own section rather than the main Settings page, and
it is locked behind a PIN that is separate from the household password. Each
person with access has their own PIN of six characters or more; an unlock lasts
fifteen minutes of activity with an eight-hour hard limit, and switching profiles
ends it on the server.

**Settings → Money** lists every device that currently has Money unlocked, with
a button to lock any of them.

Two environment variables relate to it: `BETTS_RESET_FINANCE_PIN` to clear
forgotten PINs, and `BETTS_SIMPLEFIN_HOSTS` if you run your own SimpleFIN
bridge. The full explanation of what Money's encryption does and does not
protect is in the repo's
[Money and privacy](../../README.md#money-and-privacy) section — read it before
connecting a bank.
