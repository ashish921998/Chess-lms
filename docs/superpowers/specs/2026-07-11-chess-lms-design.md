# Chess Tutor LMS — Design Spec

**Date:** 2026-07-11
**Status:** Draft (pending user review)

A learning management system for a chess tutor and their students. The tutor assigns puzzles calibrated to each student's level; students solve them and earn coins, streaks, badges, and leaderboard rank. Puzzles and student ratings come from Lichess.

## Context & Scope

This build is for a single tutor running chess classes. The data model accommodates multiple tutors for a future migration to a multi-tenant platform, but no multi-tenant UI or global cross-tutor features are in scope for the MVP. The leaderboard is scoped per-tutor (students rank only against their own class).

### In scope (MVP)
- Email/password auth with **Tutor** and **Student** roles
- Lichess OAuth: students connect their Lichess account to sync ratings
- Curated-slice Lichess puzzle library imported into Postgres
- Two puzzle-serving paths: **tutor-curated sets** and an **auto-adaptive daily queue**
- Gamification: coins (earn + spend), streaks, tutor-set daily goals, badges, per-tutor leaderboard
- Tutor dashboard: roster, student progress, puzzle set CRUD, assignment, goal-setting
- Student dashboard: practice, assigned sets, leaderboard, profile, power-up shop

### Out of scope (MVP)
- Multi-tenant platform features / cross-tutor leaderboards
- Mobile apps (web only; API is clean enough to add later)
- Writing puzzle results back to the student's real Lichess account
- Streak-freeze purchases, cosmetics storefront, Glicko-2 precise rating

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Scale | Single tutor now; data modeled for multi-tenant later |
| Tech stack | Next.js 15 (App Router) + TypeScript + Postgres + Prisma |
| Puzzles | Bulk-import a curated slice of Lichess's puzzle DB into Postgres |
| Student ratings | Lichess OAuth; game rating (rapid → blitz) as fallback when no puzzle rating |
| Coins | Earned for leaderboard rank AND spent on hints/skips/bonus packs |
| Leaderboard | Per-tutor (class-scoped) |
| Daily goals | Tutor-set per student or class |
| Puzzle selection | Blended: tutor-curated sets + auto-adaptive queue |

## Tech Stack & Structure

- **Next.js 15** App Router, React Server Components, TypeScript
- **PostgreSQL** (Neon or Supabase free tier) via **Prisma**
- **Better Auth** for email/password + **Lichess OAuth**
- **react-chessboard** + **chess.js** for board rendering and move validation
- **Tailwind CSS** + **shadcn/ui** for UI
- Deploy: **Vercel**

```
chess-lms/
├── prisma/
│   ├── schema.prisma
│   └── import-puzzles.ts        # one-time Lichess CSV import script
├── src/
│   ├── app/
│   │   ├── (auth)/              # login, signup
│   │   ├── (student)/           # dashboard, practice, leaderboard, sets, profile
│   │   ├── (tutor)/             # roster, students, sets, assign, goals
│   │   └── api/                 # lichess oauth, puzzle fetch, attempts
│   ├── lib/
│   │   ├── auth.ts
│   │   ├── lichess.ts           # OAuth + public API client
│   │   ├── puzzles/             # assigned-set + auto-queue selection
│   │   ├── gamification/        # coins, streaks, badges, goals
│   │   └── db.ts                # Prisma client
│   └── components/
│       ├── chess/               # board, puzzle card
│       ├── student/
│       └── tutor/
```

Student and tutor experiences live in separate route groups so each has its own layout, nav, and access control — two apps sharing one database. `lib/` groups logic by domain so selection and gamification are isolated, testable units.

## Data Model (Prisma)

```prisma
// ─── Users & Auth ───
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  name         String?
  role         Role     @default(STUDENT)
  createdAt    DateTime @default(now())

  student      Student?
  tutor        Tutor?
  accounts     Account[]
}

enum Role { TUTOR STUDENT }

model Account {
  id                 String   @id @default(cuid())
  userId             String   @unique
  user               User     @relation(fields: [userId], references: [id])
  lichessUsername    String
  lichessId          String   @unique
  accessToken        String   // encrypted at rest
  refreshToken       String?
  puzzleRating       Int?
  rapidRating        Int?
  blitzRating        Int?
  lastSyncedAt       DateTime?
}

// ─── Tutor & Student ───
model Tutor {
  id        String   @id @default(cuid())
  userId    String   @unique
  user      User     @relation(fields: [userId], references: [id])
  students  Student[]
  sets      PuzzleSet[]
}

model Student {
  id              String   @id @default(cuid())
  userId          String   @unique
  user            User     @relation(fields: [userId], references: [id])
  tutorId         String
  tutor           Tutor    @relation(fields: [tutorId], references: [id])

  // calibration & in-app rating
  currentRating   Int      @default(1500)
  ratingDeviation Float    @default(350)

  // gamification
  coinBalance     Int      @default(0)   // spendable
  lifetimeCoins   Int      @default(0)   // leaderboard, never decreases
  streakDays      Int      @default(0)
  lastSolveDate   DateTime?
  dailyGoal       Int      @default(5)   // tutor-set

  attempts        Attempt[]
  assignments     Assignment[]
  unlocks         Unlock[]
  badges          StudentBadge[]
}

// ─── Puzzle library ───
model Puzzle {
  id            String   @id
  fen           String
  solutionMoves String                  // UCI, space-separated
  rating        Int
  ratingDev     Int
  themes        String[]
  openingTags   String[]
  popularity    Int
  isCurated     Boolean  @default(true)

  sets          PuzzleSetItem[]
  attempts      Attempt[]
}

// ─── Tutor-curated sets (dual-mode: hand-picked OR filter-based) ───
model PuzzleSet {
  id          String   @id @default(cuid())
  tutorId     String
  tutor       Tutor    @relation(fields: [tutorId], references: [id])
  title       String
  description String?
  themeFilter String[]?
  ratingMin   Int?
  ratingMax   Int?
  isPublished Boolean  @default(false)
  createdAt   DateTime @default(now())

  items       PuzzleSetItem[]
  assignments Assignment[]
}

model PuzzleSetItem {
  id        String       @id @default(cuid())
  setId     String
  set       PuzzleSet    @relation(fields: [setId], references: [id])
  puzzleId  String
  puzzle    Puzzle       @relation(fields: [puzzleId], references: [id])
  order     Int
}

model Assignment {
  id        String    @id @default(cuid())
  setId     String
  set       PuzzleSet @relation(fields: [setId], references: [id])
  studentId String
  student   Student   @relation(fields: [studentId], references: [id])
  dueDate   DateTime?
  createdAt DateTime  @default(now())
  progress  Int       @default(0)
  completed Boolean   @default(false)

  @@unique([setId, studentId])
}

// ─── Solving history ───
model Attempt {
  id           String   @id @default(cuid())
  studentId    String
  student      Student  @relation(fields: [studentId], references: [id])
  puzzleId     String
  puzzle       Puzzle   @relation(fields: [puzzleId], references: [id])
  solved       Boolean
  usedHint     Boolean  @default(false)
  usedSkip     Boolean  @default(false)
  coinsAwarded Int      @default(0)
  timeSpentMs  Int?
  createdAt    DateTime @default(now())

  @@unique([studentId, puzzleId])
}

// ─── Gamification: purchases & badges ───
model Unlock {
  id        String    @id @default(cuid())
  studentId String
  student   Student   @relation(fields: [studentId], references: [id])
  type      UnlockType
  refId     String?
  createdAt DateTime  @default(now())
}

enum UnlockType { HINT_TOKEN SKIP_TOKEN BONUS_PACK }

model StudentBadge {
  id        String   @id @default(cuid())
  studentId String
  student   Student  @relation(fields: [studentId], references: [id])
  badgeKey  String
  awardedAt DateTime @default(now())

  @@unique([studentId, badgeKey])
}
```

**Key choices:**
- **Two coin fields** — `coinBalance` (spendable) and `lifetimeCoins` (leaderboard, immutable). Spending never erodes rank.
- **`currentRating` + `ratingDeviation`** on Student — lightweight Glicko so the auto-queue adapts from in-app solving, not just stale Lichess data.
- **`PuzzleSet` is dual-mode** — hand-pick via `PuzzleSetItem[]`, or auto-fill via `themeFilter`/`ratingMin`/`ratingMax`.
- **`Attempt` unique constraint** — one attempt per student per puzzle, preventing coin farming.

## Puzzle Selection Logic

Two paths in `src/lib/puzzles/`, sharing the one puzzle store.

### Path A — Assigned sets (tutor-curated)
1. Student opens an `Assignment`.
2. Fetch the `PuzzleSet`, then the next unattempted `PuzzleSetItem` by `order`.
3. Render the board from `puzzle.fen`.
4. On solve/fail → create `Attempt` → increment `Assignment.progress`.

The tutor did the selection upfront; serving is deterministic.

### Path B — Auto-queue ("Daily Practice")
1. Read `student.currentRating` and `ratingDeviation`.
2. Compute a level window: `[currentRating - margin, currentRating + margin]`, where `margin = ratingDeviation` (scales with uncertainty — wide for new students, tight for veterans).
3. Query `Puzzle` where `rating` is in the window and `id NOT IN` the student's attempted puzzle IDs. For MVP the auto-queue spans all themes — theme targeting is handled through tutor-assigned sets.
4. Order by `popularity DESC`, return a batch, serve one at a time.
5. On solve → `currentRating` nudges up, `ratingDeviation` narrows.
6. On fail → `currentRating` nudges down.

This is simplified Glicko — enough to keep puzzles in the student's zone of proximal development. A proper Glicko-2 implementation can replace it later without changing the interface.

**Anti-repeat:** indexed `NOT IN` against the curated slice (~150K–300K puzzles) means no student runs out.

## Gamification Rules

### Earning coins
| Event | Coins |
|---|---|
| Solve (no hint) | +10 |
| Solve with hint | +5 |
| Fail | 0 (no penalty — failing is learning) |
| Hit daily goal | +50 |
| 7-day streak milestone | +100 |

### Spending coins
| Power-up | Cost | Effect |
|---|---|---|
| Hint | 15 | Highlights next correct move |
| Skip | 30 | Marks puzzle seen, no reward, does not break streak |
| Bonus pack | 100 | Unlocks an extra themed puzzle set |

### Streaks
Incremented when the daily goal is met. Broken if a day passes without meeting it. No streak-freeze purchase in MVP.

### Badges (checked on each solve against `Attempt` history)
- `first_solve`, `streak_7`, `streak_30`, `centurion` (100 solves), `sharpshooter` (10 correct in a row), `theme_master_<theme>` (20 solves in a theme), `comeback` (solve after 3 fails in a row)

### Leaderboard
Ranks all students under a tutor by `lifetimeCoins` desc. Indexed query. Visible to students (motivation) and tutor (overview).

## Lichess Integration

### OAuth (student links account)
1. Student clicks "Connect Lichess" → redirect to `lichess.org/oauth`.
2. Lichess returns a code → `/api/auth/lichess/callback` exchanges it for an access token.
3. `GET /api/account` → `lichessId`, `lichessUsername`.
4. `GET /api/user/{username}/perf/{type}` for `puzzle`, `rapid`, `blitz` → store ratings.
5. Persist to `Account`, linked to the `Student`.

### Rating calibration
```
currentRating =
  account.puzzleRating      if present
  else account.rapidRating  if present
  else account.blitzRating  if present
  else 1500
ratingDeviation = 350   // wide — untrusted until in-app data accrues
```
Re-synced nightly via a scheduled job to track rating drift on Lichess.

### Puzzle import (one-time, `prisma/import-puzzles.ts`)
- Download `lichess_db_puzzle.csv.bz2` from Lichess.
- Stream-parse, filter to rating 400–2300, popularity > 0.
- Bulk insert in chunks of 5000 via `prisma.puzzle.createMany()`.
- Result: ~150K–300K rows, ~100MB, ~10 min runtime.

### API client
Thin `fetch` wrapper (or `lys-cjs/lichess-api`) in `src/lib/lichess.ts`. Read endpoints are generously rate-limited; one sync per student per night is negligible load.

## Application Pages

### Auth
- `/login`, `/signup` — email/password. Signup selects role (Tutor or Student).

### Student (`(student)`)
- `/dashboard` — rating, streak, daily goal progress, coin balance, assigned sets, "Start Practice"
- `/practice` — auto-queue solver; full-screen board, hint/skip buttons, coin reward animation
- `/sets/[assignmentId]` — work through a tutor-assigned set
- `/leaderboard` — class ranking by lifetime coins
- `/profile` — Lichess connection, badges, stats, power-up shop

### Tutor (`(tutor)`)
- `/roster` — students with ratings, streaks, last-active, assignment progress
- `/students/[id]` — solve history, accuracy by theme, rating trend, badges
- `/sets` — CRUD for puzzle sets (hand-pick or filter); publish
- `/assign` — assign a set to a student or class, set due date
- `/goals` — set daily puzzle target per student or class-wide

### API routes
- `/api/auth/lichess/*` — OAuth callbacks
- `/api/puzzles/next` — auto-queue fetch (called from `/practice`)
- `/api/attempts` — submit solve/fail; triggers coin + rating + streak + badge updates

## Open Questions / Future

- Glicko-2 precise rating (swap-in replacement for simplified logic)
- Streak-freeze power-up, cosmetics shop (out of MVP scope)
- Multi-tenant platform features (data model already supports it)
- Mobile app (API is clean enough to support one later)
