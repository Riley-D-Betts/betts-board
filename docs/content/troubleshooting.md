# Troubleshooting

Symptom by symptom. Most problems here are one of two things: the board is not
being served over HTTPS, or the outbound-fetch guard is doing its job.

## Push notifications are silent

Work through these in order:

1. **Are you on HTTPS?** Web push is secure-context only. Over plain HTTP the
   feature cannot work at all — **Settings → Notifications** will say so rather
   than failing quietly. See [HTTPS](./https.md).
2. **Is this device subscribed?** The switch is per browser, not per household:
   **Settings → Notifications → Notify on this device**. A phone that never had
   it turned on gets nothing.
3. **Did the browser grant permission?** If you dismissed or blocked the
   permission prompt, the browser will not ask again — clear the site's
   notification permission in browser settings and toggle the switch again.
4. **On iOS, is the board installed to the home screen?** Safari does not deliver
   web push to a normal tab. Add to Home Screen first, open it from the icon,
   then subscribe.
5. **Is the container still running?** Notifications dispatch on a once-a-minute
   scheduled task inside the container. A host that sleeps is a board that sends
   nothing. Check `docker compose ps`.

Reminders are also per profile. A notification for an event nobody's profile is
attending, or a chore assigned to someone else, is not sent to you.

## The board won't install to a phone's home screen

- **Secure context required.** Same root cause as push. See
  [HTTPS](./https.md).
- **It may already be installed.** Browsers hide the install prompt once the app
  is installed. Look for the icon before assuming it failed.
- **Some in-app browsers cannot install PWAs at all.** If you followed a link
  from a messaging app, open the board in the real browser first.

## The barcode scanner says the camera is unavailable

The camera API is secure-context only, so the pantry scanner needs HTTPS just
like push notifications do — see [HTTPS](./https.md).

If you are on HTTPS and it still fails, the browser is most likely holding a
denied camera permission for the site. Clear it and reload.

An unknown barcode is a different thing and not an error: look it up, and if
nothing comes back you can save a name for that code yourself so the next scan
recognizes it.

## A calendar feed isn't importing

- **Is the URL really iCal?** It has to be an `.ics` feed, not the HTML page of a
  calendar. `https://` and `webcal://` are both fine. If opening the URL in a
  browser shows a web page rather than downloading a file, it is the wrong URL —
  look for a "subscribe" or "iCal" link on the calendar's own site.
- **Have you waited for the refresh?** Feeds are fetched immediately when added,
  then on their own interval — 15 minutes by default, configurable up to a day.
  **Refresh now** forces a fetch.
- **Is the feed on your own network?** The board refuses to fetch private,
  loopback, and link-local addresses by default. A calendar on your NAS needs
  that host added to `BETTS_ALLOW_PRIVATE_FETCH_HOSTS` — see
  [Configuration](./configuration.md#about-the-private-fetch-guard).
- **Is the feed enabled?** A disabled feed stays in the list and stops updating.

Imported events are read-only by design. Trying to edit one returns an error
rather than silently diverging from the feed.

## A recipe import fails

Recipe import scrapes the page you paste, so it depends on that page publishing
recipe metadata. Some sites do not.

If the URL is on your own network, the private-fetch guard applies here too. The
same variable opens it, one host at a time.

When import cannot parse a page, add the recipe by hand — nothing else about it is
second-class.

## The container won't start

```bash
docker compose logs betts-board
```

The usual causes:

- **The port is already bound.** `Error starting userland proxy: bind: address
  already in use` means something else holds port 3000. Publish a different host
  port — see [Install](./install.md#ports).
- **Volume permissions.** The container runs as an unprivileged user and owns
  `/data`. This bites when a bind mount to a host directory replaces the named
  volume; the named volume in the shipped compose file does not have the problem.
- **The build failed rather than the boot.** On a Pi, native modules compile from
  source and the first build is slow. A build that ran out of memory looks like a
  container that never appeared.

If the container is up but the healthcheck never goes healthy, the board is
failing to serve `/api/health` — the logs will say why.

## An update didn't seem to apply

Check **Settings → About this board**. It shows the version, the commit, and the
build date. If the build date is older than your `git pull`, the image was not
actually rebuilt:

```bash
git pull
docker compose up -d --build
```

The same details are at `/api/health` if you would rather check with `curl`.

## I forgot the household password

Boot once with `BETTS_RESET_PASSWORD=1` and the unlock screen lets you set a new
one. Full instructions, including why it only acts once, are in
[Reset the password](./backup-restore.md#reset-the-password).

If the unlock screen is refusing attempts rather than rejecting them, you have
hit the rate limit — up to fifteen minutes after repeated failures. It never
locks permanently and one correct password clears it.

## I forgot a Money PIN

Boot once with `BETTS_RESET_FINANCE_PIN=1`. Bank connections and history survive;
whoever sets a PIN first afterwards becomes the Money owner. See
[Reset a Money PIN](./backup-restore.md#reset-a-money-pin).

## Money is missing from the navigation

On a device flagged as a wall display, that is deliberate — the Money item is
hidden entirely. Turn off **Settings → This device → Use as wall display** on a
device where you want it.

It is also absent from `/tv/*` unconditionally, and it is never on the dashboard,
in the shared calendar feed, or in push notification text. Those are all by
design and enforced by tests.

## Weather isn't showing

Set a location under **Settings → Household → Weather location**. Until one is
configured, the weather endpoint returns nothing — there is no default. Sunrise
and sunset for TV mode's automatic theme come from the same setting, and fall
back to a 7am–7pm window without it.
