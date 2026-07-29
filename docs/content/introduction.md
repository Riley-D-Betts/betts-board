# What is Betts Board?

Betts Board is a self-hosted family organizer for the kitchen tablet, the TV,
and everyone's phones. It runs as **one Docker container with one data
volume** on hardware you already own, and it is free software under the
[AGPL-3.0](../../LICENSE). Your family's calendar, chores, recipes, and
photos stay on your own server — no subscriptions, no accounts with big
tech.

Under the hood it is a single Nuxt server in front of a SQLite database.
There is no separate backend, no external database to run, and no cloud
component: if your box is on, the board is up, whether or not your internet
is.

## What it replaces

Most families end up spread across a shared cloud calendar, a chore-chart
app, a recipe-clipping service, and a grocery-list app — each with its own
account, its own subscription, and its own copy of your data. Betts Board
pulls those jobs into one board on your own hardware:

- the shared calendar, color-coded per person, with recurring events that
  handle "edit this / this and future / all" properly
- the chore chart, with points, streaks, and a leaderboard the kids will
  actually check
- the recipe box and weekly meal plan — paste a link and the recipe is
  parsed and saved locally
- the shopping list and pantry that feed each other
- the photo frame the wall tablet turns into when nobody is using it

The full feature-by-feature rundown lives on the
[project site](https://betts-board.pages.dev/#features); the highlights are
also in the [README](../../README.md).

## What it deliberately does not do

- **No hosted tier.** There is no paid plan, no premium tier, and nothing
  to sign up for. You run it; you own it.
- **No per-person accounts.** One shared household password unlocks the
  board, and each family member has a profile for calendar colors and chore
  assignments. Kids don't need email addresses.
- **No telemetry.** The only outbound requests are the ones you set up
  yourself: weather from Open-Meteo, iCal feeds you subscribe to, recipe
  pages you paste, and Web Push delivery for reminders you turn on.

## What it needs to run

Any machine that runs Docker and Docker Compose is enough:

- a NAS that runs Docker
- an old laptop or mini PC in a closet
- a Raspberry Pi 4 or 5

The runtime is one Node server plus SQLite, so there is no database server
to size and no cluster to manage. The container keeps everything — the
database, uploaded photos, recipe images — in a single named volume, which
makes [backup](./backup-restore.md) a one-command affair.

A domain name is optional. The board works over plain HTTP on your LAN;
push notifications, home-screen install, and the barcode scanner need
HTTPS, and [there are three easy ways to get it](./https.md) — including
one that needs no domain at all.

## Where to go next

- [Install](./install.md) — from `git clone` to the setup wizard in a few
  minutes.
- [HTTPS and remote access](./https.md) — unlock notifications, the PWA
  install, and the scanner.
- [Everyday use](./everyday-use.md) — phones, the wall tablet, and the TV.
