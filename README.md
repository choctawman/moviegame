# Movie Fantasy League (Fantasy Football for Movies)

Mobile-first web app for 5-team, head-to-head movie fantasy leagues with snake/auction drafts, waivers, trades, and monthly scoring based on worldwide box office + Rotten Tomatoes snapshots.

## Tech Stack

- Next.js App Router + TypeScript + Tailwind CSS
- Custom Node server (`server.ts`) for Next + Socket.IO realtime draft namespace
- PostgreSQL + Prisma ORM
- Redis + BullMQ for timers/background jobs
- Vitest for unit tests

## Core v1 Rules Implemented

- Calendar-year season (`seasonYear`)
- League cycle window: Thursday 00:00:00 -> Wednesday 23:59:59 (league timezone)
- 5-team league schedule using rotating doubleheader pattern (no byes)
- 12-slot roster: 7 starters + 5 bench (bench accepts any role)
- Snake + auction draft support
- Rolling waiver priority with manual nomination pool (1 nomination/team/month)
- No direct add/drop; adds happen only through waivers
- Monthly cycle windows (league local time):
  - nominations: 25th 12:00 AM -> month end
  - waiver pool publish: 1st 12:00 AM
  - claims: 1st 12:00 AM -> first Thursday 12:00 PM (processed first Thursday 12:00 PM)
  - lineup lock: first Friday 11:59 PM
  - matchup scoring: full calendar month
- In-roster lineup moves allowed between applicable slots until the first Friday monthly lineup lock
- League notifications for nomination pool publish, waiver results, and monthly matchup summaries
- Trades with optional commissioner veto window
- Decimal scoring (2dp, round-half-up)

## Getting Started

### 1) Install

```bash
npm install
```

### 2) Configure environment

```bash
cp .env.example .env
```

Required env vars (defaults in `.env.example`):

- `DATABASE_URL`
- `REDIS_URL`
- `SESSION_COOKIE_NAME`
- `SESSION_TTL_DAYS`
- `APP_URL`
- `TMDB_API_KEY`
- `TMDB_BASE_URL`
- `TMDB_DISCOVER_MAX_PAGES`
- `TMDB_REQUEST_DELAY_MS`
- `TMDB_REGION`
- `TMDB_ORIGIN_COUNTRY`
- `TMDB_MIN_RUNTIME_MINUTES`
- `TMDB_ORIGINAL_LANGUAGE`
- `TMDB_RELEASE_TYPES`
- `RT_SCRAPE_BASE_URL`
- `BOXOFFICE_BASE_URL`
- `PROVIDER_CACHE_TTL_SECONDS`
- `PROVIDER_RATE_LIMIT_MIN_TIME_MS`

To import real movie/player data, add a TMDB v4 Read Access Token to `TMDB_API_KEY`.
Season eligibility for player/movie pool is:
- theatrical release date on or after January 1 of the season year
Default ingestion quality filters are US-focused:
- region: `US`
- origin country: `US`
- release type: `2|3` (theatrical)
- min runtime: `70` minutes
- original language: `en`

### 3) Start Postgres and Redis

Use your local setup (Docker, managed services, or native installs).

Example connection defaults used by the app:

- Postgres: `postgresql://moviegame:moviegame@localhost:5432/moviegame?schema=public`
- Redis: `redis://localhost:6379`

### 4) Generate Prisma client and run migrations

```bash
npm run prisma:generate
npm run prisma:migrate
```

### 5) Seed a commissioner account

```bash
npm run seed
```

Optional: grant commissioner access to an existing user.

```bash
npm run commissioner:add -- user@example.com
```

## Running the App

### Non-technical quick start (macOS)

Double-click:

- `Install Movie Game.command` for the first run on a new Mac
- `Start Movie Game.command`

`Install Movie Game.command` will:

- install Apple Command Line Tools if needed
- install Homebrew if needed
- install Node.js, PostgreSQL, and Redis
- create `.env` from `.env.example`
- install npm packages
- launch the game

After that, `Start Movie Game.command` will automatically:

- starts PostgreSQL + Redis
- prepares database user/db
- runs Prisma migrations
- seeds commissioner user
- builds and starts web + worker
- opens the app in your browser

To stop everything, double-click:

- `Stop Movie Game.command`

### Web + API + Socket.IO server

```bash
npm run dev:web
```

### Worker process (BullMQ)

```bash
npm run dev:worker
```

### Production

```bash
npm run build
npm run start
```

## Import Real Movies and Players

1. Make sure `TMDB_API_KEY` is set in `.env`.
2. Start app + worker (using `Start Movie Game.command` is easiest).
3. Log in as commissioner (`commissioner@example.com` / `password123` by default seed).
4. Open your league home page.
5. In **Real Player Data**, click **Import / Refresh Real Data**.

The app will queue a background ingestion job and populate:

- `Movie`
- `Person`
- `Credit`
- `FantasyPlayer`

When complete, your Player Pool and Draft pages will show real people and movies for that season.

## Background Jobs

Workers process these queues:

- `league-jobs`
  - `build-season-calendar`
  - `generate-schedule`
- `ingestion-jobs`
  - `ingest-season`
  - `ingest-daily-stats`
- `scoring-jobs`
  - `finalize-week`
- `waiver-jobs`
  - `process-waivers`
- `draft-jobs`
  - `autopick`

Manually enqueue jobs for local testing:

```bash
npm run jobs:enqueue-dev
```

Backfill missed monthly box-office boundary snapshots from archived Box Office Mojo pages:

```bash
npm run backfill:wayback-box-office -- --dry-run
npm run backfill:wayback-box-office -- --leagueId=<leagueId> --weekId=<weekId> --force
```

Flags:

- `--dry-run`: show what would be updated without writing or recomputing scores
- `--leagueId=<id>` / `--weekId=<id>` / `--movieId=<id>`: narrow the backfill scope
- `--force`: replace existing stored boundary snapshots with Wayback-derived values
- `--maxDistanceHours=<n>`: reject archived pages farther than `n` hours from the month boundary (default `72`)

## Realtime Draft Socket

- Namespace: `/draft`
- Key events:
  - Client -> Server: `draft:join`, `draft:leave`, `draft:pick`, `draft:nominate`, `draft:bid`, commissioner controls
  - Server -> Client: `draft:state`, `draft:pickMade`, `draft:paused`, `draft:resumed`, `draft:bidUpdate`, `draft:error`

## API Highlights

Implemented route groups include:

- Auth: `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
- Leagues: create, invites/join, settings/rules, teams, matchups/weeks
- Rosters: `/api/teams/:teamId/roster` (GET + lineup slot move POST)
- Player pool + player detail
- Waivers: status, nominations, claims, mine, priority
- Notifications: surfaced on home + league pages
- Draft controls: start/pause/resume/force/undo/state
- Trades: propose/list/accept/reject/cancel/veto
- Transaction history

## Providers

Provider abstraction is implemented for swapability:

- Ratings: `RatingsProvider`
  - `RtScraperProvider` (scrape-based)
  - `MockRatingsProvider` fallback
- Box office: `BoxOfficeProvider`
  - `BoxOfficeScraperProvider` (scrape-based cumulative worldwide)
  - `MockBoxOfficeProvider` fallback

Raw provider payloads are persisted in `MovieWeekStat.rawSource` for auditability.

## Tests

Run unit tests:

```bash
npm test
```

Included acceptance-oriented unit coverage:

- Week generation and boundaries
- Roster slot constraints
- Deterministic auto-pick ordering
- Waiver lock window
- Waiver claim conflict resolution and invalid drop handling
- Scoring math + matchup tie-break behavior

## Notes

- This repo includes an initial SQL migration at `prisma/migrations/0001_init/migration.sql`.
- In this environment, Docker wasn’t available during generation; migration SQL was produced with `prisma migrate diff`.
- For full integration and E2E tests, run against a live Postgres + Redis instance.
