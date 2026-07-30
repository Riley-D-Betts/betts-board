# Everyday use

Once the board is [installed](./install.md), the goal is for it to
disappear into the household: an app icon on every phone, a photo frame in
the kitchen, a dashboard on the TV. Here is how each screen gets set up,
plus how profiles and calendar subscriptions work day to day.

## Phones

Open the board in the phone's browser and choose **Add to Home Screen**. It
installs as an app, with its own icon and no browser chrome. Installing
requires the board to be served over HTTPS — see
[HTTPS and remote access](./https.md).

Two phone-first touches worth knowing:

- The shopping list is built for the store: items are grouped by aisle,
  with fast in-store check-off.
- The pantry scans barcodes with the phone camera (HTTPS required), and
  shopping-list generation skips what the pantry already has.

## The kitchen tablet

The wall tablet is the board's natural home:

1. Sign in once — sessions last 90 days, so it stays signed in.
2. Turn on **Settings → This device → Use as wall display**.

With wall display on, the tablet becomes a photo frame whenever it sits
idle: your uploaded photos rotate alongside a clock, the weather, and
today's agenda. Tap the screen or press any key to get back to the board.
The toggle is per-device — it affects only the tablet you flip it on.

## The TV

Any TV browser works; the TV pages are big-type and D-pad friendly:

- `/tv` — the dashboard, sized for reading from the couch
- `/tv/slideshow` — straight to the photo slideshow

## Profiles

The household shares one password; people are told apart by **profiles**,
created during the setup wizard. You switch the active profile right on the
board — there are no separate logins — and the profile drives calendar
colors, chore assignments, points, and the leaderboard. Sessions last 90
days, so shared devices don't demand the password every morning.

## Calendar feeds

Feeds run in both directions.

### Pulling a school or sports calendar in

Go to **Settings → Calendar feeds → Add** and paste the iCal URL from the
school or club website. Imported events show up alongside the family's
own, and they flow through the same recurrence engine as local events, so
repeating practices and term dates expand correctly.

### Pushing the family board to your phone's calendar

Under **Settings → Calendar feeds → Subscribe on your phone**, the board
gives you a private URL. Subscribe to it from your phone's calendar app
and the family schedule appears next to your work calendar. Treat the URL
like a password — anyone who has it can read the family calendar.
