# What is Betts Board?

Betts Board is a family organizer that runs on your own server. One Docker
container, one data volume. The calendar, chores, recipes, photos, and
everything else live on hardware you control, and there are no subscriptions
and no accounts with anyone else.

It is built for three screens at once: the tablet on the kitchen wall, the TV
in the living room, and the phone in everyone's pocket. The same board, scaled
to whatever is looking at it.

## What it replaces

- Shared cloud calendars, for the household's own events
- Chore and allowance apps, including the points and the leaderboard
- Recipe boxes and meal-planning services
- Shopping-list apps
- A digital photo frame
- Birthday and holiday wish lists scattered across other people's stores

## What it does

- **Family calendar** — month, week, day, and agenda views, color-coded per
  person, with recurring events (daily through yearly, plus custom rules) and
  proper "edit this / this and future / all" handling.
- **Chores** — assigned to family members, on recurring schedules, with points,
  streaks, and a leaderboard. View the week by day or by person.
- **Rewards store** — kids spend earned stars on rewards a parent defines.
  Balances and history are tracked for you.
- **Recipes** — paste a link and the recipe is parsed and saved locally, with
  ingredients, steps, and a photo. Rate it and note tweaks for next time.
- **Meal planning** — plan the week from your recipe box, assign who is
  cooking, and a prep block lands on their calendar ending at mealtime.
- **Shopping lists** — generated from the meal plan with quantity merging and
  aisle grouping, or cherry-picked from any planned meal.
- **Pantry** — track what you already have, scanning barcodes with a phone
  camera. Shopping generation skips what is in the pantry.
- **Wish lists** — per person, with links, rough prices, and a countdown.
- **Photo slideshow** — idle wall displays become a photo frame with the clock,
  the weather, and today's agenda.
- **Calendar feeds** — subscribe to school and sports iCal feeds, and subscribe
  your phone's calendar app to the family board.
- **Weather** — from Open-Meteo, no API key needed.
- **Push notifications** — event reminders and chore nudges. Needs HTTPS; see
  [HTTPS](./https.md).
- **TV mode** — a big-type dashboard and slideshow for any TV browser, scaled to
  the resolution the set reports, switching between light and dark at sunrise
  and sunset.
- **Appearance and language** — household-wide fonts and accent colors, set
  separately for light and dark mode. The board speaks English, Spanish, or
  French. Fonts and translations are served from your own server, so nothing is
  fetched from Google or a translation service and it all works offline.
- **Money** — accounts, transactions, budgets, bills, savings goals, and a
  cash-flow forecast, behind its own PIN and deliberately never shown on the
  dashboard, the wall display, or the shared calendar.
- **Public API** — a token-authenticated REST API for Home Assistant and
  scripts, with keys managed in Settings.

## What it deliberately does not do

- **No hosted tier.** There is nothing to sign up for. You run it or you don't.
- **No accounts with anyone else.** One shared household password, and a profile
  per family member. Profiles are not logins with passwords — switching profiles
  is a tap, which is right for a kitchen tablet and is why Money has a separate
  PIN.
- **No telemetry.** The app makes no outbound requests at page load. The only
  network calls it ever makes are ones you ask for: the weather forecast, recipe
  imports, calendar-feed refreshes, barcode lookups, and a one-time font
  download.
- **No multi-tenancy.** One installation serves one household.

## What you need to run it

Any machine that runs Docker and Docker Compose: a Linux box, a NAS, an old
laptop, a Raspberry Pi 4 or 5. Inside the container it is one Node server and
one SQLite database, so the requirements are modest and there is nothing else to
provision — no separate database service, no cache, no queue.

You will also want to think about HTTPS before long. The board works fine over
plain HTTP on your LAN, but push notifications, installing to a phone's home
screen, and the camera barcode scanner all require a secure context.

## Where to go next

Install it — [Install](./install.md) has the quick start, the setup wizard, and
what first boot does.
