# Everyday use

The board is one installation shown three ways. This page covers setting up each
surface and the two things households ask about most: profiles and calendar
feeds.

## Phones

Open the board in the phone's browser and choose **Add to Home Screen**. It
installs as a PWA and behaves like an app — its own icon, no browser chrome, and
it keeps working when the network is flaky.

This needs HTTPS. Over plain HTTP the install prompt never appears. See
[HTTPS](./https.md).

On a phone the navigation is four tabs around a raised centre button. That button
opens a full-screen menu listing every section, the profile switcher, and Lock.

Turn on notifications per device under **Settings → Notifications → Notify on
this device**. Each person gets event reminders and chore due-times for their own
profile. On iOS the board has to be installed to the home screen first — Safari
does not deliver web push to a normal tab.

## The kitchen tablet

This is the screen the board was designed around.

1. Unlock it once with the household password. Sessions last 90 days, so you are
   not typing it again.
2. Turn on **Settings → This device → Use as wall display**.

That flag is per device, not household-wide. With it on, the tablet starts the
photo slideshow when it sits idle and becomes a photo frame with the clock, the
weather, and today's agenda. Tap the screen or press any key to get back to the
board.

Tune the behavior under **Settings → Slideshow**: how many minutes of idle time
before it starts, seconds per photo, the transition, and whether to show the
clock, the weather, and today's agenda. There is a **Preview slideshow** button
so you do not have to wait for the idle timer to see your changes.

Views that a wall tablet might sit on all day refresh themselves — on focus, on
visibility change, and on a short poll while visible — so the board on the wall
does not drift out of date.

## The TV

Open `/tv` in the TV's browser for the big-type dashboard, or `/tv/slideshow` to
go straight to the photos. Type scales to whatever resolution the set reports,
and the pages are built for a D-pad rather than a mouse, so nothing is
hover-only.

TV mode picks light or dark from sunrise and sunset by default. That is a
household-wide choice, not a per-device one — set it under **Settings →
Appearance → TV mode theme**, where you can also pin it to always light or always
dark. Sunrise and sunset come from your weather location; without one it falls
back to a 7am–7pm window.

Money never appears on `/tv/*`. Those pages run without an acting profile and the
server refuses them outright.

## Profiles

Tap a name to switch. There is no password — that is deliberate, because a
kitchen tablet with a per-person login is a kitchen tablet nobody uses.

What profiles do:

- Attribute events, chore completions, notes, and photo uploads to a person
- Color-code the calendar
- Drive the chore leaderboard and reward-star balances
- Carry a role: kids can only complete and redeem for themselves, adults manage
  chores and rewards, and admins additionally reach settings-level things like
  feeds, profiles, and API keys

Because switching takes no password, the admin role protects against accidents
and stray API keys — not against a person standing at the tablet. That is why
Money has its own PIN, and why unlocking Money ends when you switch profiles.

Manage everyone under **Settings → Family members**.

## Calendar feeds in

Subscribe the board to school, sports, or work calendars under **Settings →
Calendar feeds → Add feed**. Give it a name and an `.ics` URL — `https://` or
`webcal://` both work.

- The feed is fetched immediately when you add it, then refreshed on a schedule
  (every 15 minutes by default; each feed's own interval can be set between 15
  minutes and a day).
- Imported events are read-only on the board. They expand through the same
  recurrence pipeline as local events, so a recurring school event behaves
  properly.
- Each feed gets a color, so it is obvious on the calendar which events came
  from where.
- **Refresh now** forces a fetch if you cannot wait. Removing a feed also removes
  the events it imported.

If the URL lives on your own network — a calendar on your NAS, say — the board
refuses it by default. That is a deliberate guard, and
`BETTS_ALLOW_PRIVATE_FETCH_HOSTS` is how you open exactly that one host. See
[Configuration](./configuration.md#environment-variables).

## Calendar feeds out

To see the family board in a phone's own calendar app, go to **Settings →
Calendar feeds → Subscribe on your phone** and add that URL as a subscribed
calendar.

Treat the URL as a secret. It is unguessable rather than password-protected, so
anyone holding it can read the family calendar. You can reset it, which
invalidates the old link — every device that had subscribed then has to add the
new one.

Bills from Money are not in this feed, by design. The export URL is handed to
every unlocked client, so a bill on the shared calendar would be a bill
published to anyone with the link.
