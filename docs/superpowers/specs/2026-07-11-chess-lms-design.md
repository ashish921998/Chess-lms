# Chess Tutor LMS — Design Spec

**Date:** 2026-07-11
**Status:** v3.0 (pragmatic V1 — cut over-engineering, keep real safeguards)
**Revision note:** v2.2 went through four architecture reviews that progressively gold-plated theoretical race conditions irrelevant at V1 scale (one tutor, ~30 students). v3.0 cuts `AcceptedCommand`/`commandId` idempotency infrastructure, `AttemptReservation` (the PENDING Attempt is the reservation), `RatedPuzzle` pair-level claims, FILTER mode, bonus packs, and the `Unlock` inventory model. It keeps the safeguards that prevent actual damage: authorization guards, server-side move validation, transactional spending/finalization, conditional status updates, unique ledger keys, and one-PENDING-attempt-per-student. Six concrete launch bugs from v2.2 are fixed: Prisma relation errors, insufficient-funds partial commits, `/next` on refresh, assignment integrity, hint solution leaking, and `ON CONFLICT` targets.

**v3.0.1 patch:** three self-audit fixes — (1) the FAILED path now gates Elo on `isReplay` (was inconsistent with the replay rule), (2) `Assignment.progress` uses atomic increment instead of count-and-set (lost-update fix for concurrent solves on different items), (3) `PuzzleSetItem` gets `@@unique([setId, order])` to match `PuzzleSetVersionItem`.

A learning management system for a chess tutor and their students. The tutor assigns puzzles calibrated to each student's level; students solve them and earn coins, streaks, badges, and leaderboard rank. Puzzles and student ratings come from Lichess.

## Context & Scope

This build is for a single tutor running chess classes. **One class per tutor** for MVP — there is no `Class` entity; a tutor's roster *is* the class, and "class-wide" actions broadcast to all of the tutor's students. The data model accommodates multiple tutors for a future migration, but no multi-tenant UI or cross-tutor features are in scope.

### In scope (V1)
- Email/password auth with **Tutor** and **Student** roles (Better Auth)
- Lichess OAuth (PKCE, optional): students may connect Lichess to sync ratings
- Curated-slice Lichess puzzle library imported into Postgres
- Two puzzle-serving paths: **tutor-curated manual sets** and an **auto-adaptive daily queue**
- Server-authoritative solve validation (client never sees the solution)
- Gamification: coins (earn + spend on hints/skips), streaks, tutor-set daily goals, badges, per-tutor leaderboard
- Tutor dashboard: roster, student progress, puzzle set CRUD, assignment, goal-setting
- Student dashboard: practice, assigned sets, leaderboard, profile
- Students without Lichess: supported via in-app Elo calibration from practice

### Out of scope (V1)
- Multi-class / multi-tenant platform features (data model is forward-compatible)
- Writing results back to the student's real Lichess account
- FILTER-mode puzzle sets (theme/rating auto-generated sets) — ship MANUAL sets only
- Bonus pack shop / power-up inventory — ship hints and skips only (pay at use)
- Streak-freeze purchases, cosmetics storefront
- Precise Glicko-2 (a documented Elo approximation is used)

## Decisions

| Decision | Choice |
|---|---|
| Scale | Single tutor / one class; data modeled for multi-tenant later |
| Tech stack | Next.js 15 (App Router) + TypeScript + Postgres + Prisma |
| Auth | Better Auth (manages its own schema) + Lichess PKCE OAuth |
| Puzzles | Curated slice of Lichess DB imported via PostgreSQL COPY |
| Student ratings | Lichess puzzle rating as a *prior*; in-app Elo tracks actual skill separately |
| Lichess | Optional; Elo-from-practice adapts for unlinked students |
| Coins | Earned (leaderboard) + spent (hints/skips); append-only ledger |
| Leaderboard | Per-tutor; display names; deterministic tie-breakers |
| Daily goals | Tutor-set per student or class-wide |
| Puzzle selection | Blended: tutor-curated manual sets + auto-adaptive queue |
| Power-ups | Hint (reveal move) + Skip (move on) — pay at use, no inventory model |

## Tech Stack & Structure

- **Next.js 15** App Router, React Server Components, TypeScript
- **PostgreSQL** (Neon, pooled connection string for serverless) via **Prisma**
- **Better Auth** for email/password + Lichess PKCE OAuth
- **react-chessboard** + **chess.js** for board rendering and server-side move validation
- **Tailwind CSS** + **shadcn/ui** for UI
- Deploy: **Vercel** (puzzle import runs locally/CI, never on Vercel)

```
chess-lms/
├── prisma/
│   ├── schema.prisma
│   ├── scripts/
│   │   ├── import-puzzles.ts     # local/CI import via COPY, resumable
│   │   └── seed-tutor.ts         # administrative tutor seeding
│   └── migrations/
├── src/
│   ├── app/
│   │   ├── (auth)/               # login, signup (student invite codes)
│   │   ├── (student)/
│   │   ├── (tutor)/
│   │   └── api/
│   │       ├── auth/lichess/*    # PKCE OAuth callbacks
│   │       ├── puzzles/next      # auto-queue fetch (opaque, no solution)
│   │       ├── attempts          # server-authoritative solve finalization
│   │       └── cron/*            # CRON_SECRET-protected nightly sync + sweep
│   ├── lib/
│   │   ├── auth.ts               # Better Auth config (role = additional field)
│   │   ├── auth-guards.ts        # requireStudent() / requireTutor()
│   │   ├── lichess.ts            # PKCE client; ratings from /api/account
│   │   ├── puzzles/
│   │   │   ├── selection.ts      # auto-queue (NOT EXISTS anti-join + fallback ladder)
│   │   │   ├── assigned.ts       # tutor-set serving
│   │   │   └── validate.ts       # server-side move validation via chess.js
│   │   ├── rating.ts             # documented Elo with K-factor
│   │   ├── gamification/
│   │   │   ├── coins.ts          # append-only ledger, idempotent
│   │   │   ├── streaks.ts        # DailyProgress-derived
│   │   │   └── badges.ts         # idempotent upserts
│   │   └── db.ts
│   └── components/{chess,student,tutor}/
```

## Auth, Roles & Authorization

### Better Auth owns user/session schema
User, session, verification, and account models are generated by Better Auth's CLI. We do **not** hand-roll these. The app-specific `role` ("TUTOR" | "STUDENT") is added as a Better Auth **additional field** (server-only, not client-writable). Password hashing, email verification, and password reset are configured through Better Auth.

### Enrollment model (no public tutor signup)
- **Tutor is seeded administratively** (`prisma/scripts/seed-tutor.ts`). There is no public "sign up as tutor" path.
- **Students enroll via invitation codes.** The tutor generates codes from their dashboard; the signup form requires a valid code. The code binds the new student to the generating tutor. Codes are random crypto-generated strings; no hashing-at-rest or rate-limiting subsystem is needed for a known roster.
- A student may operate **without linking Lichess** (see Rating Calibration).

### Authorization guards
Every route and API handler resolves the authenticated user to a `Student` or `Tutor` profile, then scopes **all** queries through that profile:
- `requireTutor()` — returns the tutor profile or 401.
- `requireStudent()` — returns the student profile or 401.
- Any by-ID access (student profile, assignment, attempt) is filtered by `tutorId` (tutor context) or `id === session.student.id` (student context). A record that exists but belongs to another tutor/student returns **404**, not 403 (no existence leak).

### Privacy & deletion
- Leaderboards use **display names** (set by student/tutor, never auto-derived from email), never emails.
- Better Auth email verification and password reset are enabled.
- **Student deletion** cascades to attempts, daily progress, badges, coin ledger, rating events, and `StudentPuzzle` — all student-owned data is purged.
- **Published content is archival:** `PuzzleSetVersion` is `onDelete: Restrict` from `Assignment` (you can't delete a version an assignment depends on). The coin ledger is append-only; a "refund" is a compensating row, never a delete.

## Data Model (Prisma)

Better Auth-generated models (`user`, `session`, `account`, `verification`) are omitted below; only app models are shown. The Lichess link lives in a custom `LichessConnection` (not Better Auth's generic `account`).

```prisma
// ─── Tutor & Student profiles (1:1 with Better Auth user) ───
model Tutor {
  id        String   @id @default(cuid())
  userId    String   @unique
  students  Student[]
  sets      PuzzleSet[]
  invites   InviteCode[]
  createdAt DateTime @default(now())
}

model Student {
  id            String   @id @default(cuid())
  userId        String   @unique
  tutorId       String
  tutor         Tutor    @relation(fields: [tutorId], references: [id], onDelete: Cascade)
  displayName   String                       // shown on leaderboard
  timezone      String   @default("UTC")     // IANA tz for daily boundaries
  createdAt     DateTime @default(now())

  // ratings — external (Lichess prior) and in-app (actual skill) kept SEPARATE
  lichessPuzzleRating Int?                   // pulled at link time, periodic sync
  lichessGameRating   Int?                   // rapid → blitz fallback
  inAppRating         Int     @default(1500) // Elo, updated by server on each solve
  ratingK             Int     @default(40)   // K-factor, decreases as games accrue

  // gamification balances (caches over CoinTransaction — see ledger)
  coinBalance         Int     @default(0)    // spendable
  lifetimeCoins       Int     @default(0)    // leaderboard, never decreases
  dailyGoal           Int     @default(5)    // tutor-set

  lichess             LichessConnection?
  attempts            Attempt[]
  seenPuzzles         StudentPuzzle[]
  dailyProgress       DailyProgress[]
  assignments         Assignment[]
  badges              StudentBadge[]
  coinTxns            CoinTransaction[]
  ratingEvents        RatingEvent[]
}

model LichessConnection {
  id              String   @id @default(cuid())
  studentId       String   @unique
  student         Student  @relation(fields: [studentId], references: [id], onDelete: Cascade)
  lichessId       String   @unique
  lichessUsername String
  // token is used once to read ratings, then discarded. Ratings are public.
  lastSyncedAt    DateTime?
}

model InviteCode {
  id        String    @id @default(cuid())
  tutorId   String
  tutor     Tutor     @relation(fields: [tutorId], references: [id], onDelete: Cascade)
  code      String    @unique               // crypto-generated random string
  uses      Int       @default(0)
  maxUses   Int       @default(1)
  expiresAt DateTime?
  createdAt DateTime  @default(now())
}

// ─── Puzzle library ───
// At import time the FIRST UCI move (the opponent's setup move) is APPLIED to the
// FEN, so `startFen` is the position the student actually plays from. The stored
// `solutionMoves` begins with the student's first move.
model Puzzle {
  id            String   @id
  startFen      String                       // AFTER opponent setup move applied
  solutionMoves String[]                     // student-side moves, UCI, in order
  rating        Int                          // Lichess puzzle rating (prior only)
  ratingDev     Int
  themes        String[] @default([])
  openingTags   String[] @default([])
  popularity    Int
  importedAt    DateTime @default(now())

  setItems      PuzzleSetItem[]
  setVersionItems PuzzleSetVersionItem[]
  attempts      Attempt[]
  seenBy        StudentPuzzle[]
  assignmentItems AssignmentItemProgress[]   // reverse relation

  @@index([rating])
  @@index([popularity])
}

// Anti-repeat + "seen" state (one record per student+puzzle, written only on SOLVED)
model StudentPuzzle {
  studentId  String
  puzzleId   String
  student    Student @relation(fields: [studentId], references: [id], onDelete: Cascade)
  puzzle     Puzzle  @relation(fields: [puzzleId], references: [id], onDelete: Cascade)
  firstSeenAt DateTime @default(now())
  lastSeenAt  DateTime @updatedAt
  timesSeen   Int      @default(1)

  @@id([studentId, puzzleId])
  @@index([studentId, lastSeenAt])
}

// ─── Tutor sets: manual puzzle selection, published as immutable versions ───
model PuzzleSet {
  id          String       @id @default(cuid())
  tutorId     String
  tutor       Tutor        @relation(fields: [tutorId], references: [id], onDelete: Cascade)
  title       String
  description String?
  isPublished Boolean       @default(false)
  createdAt   DateTime      @default(now())

  items       PuzzleSetItem[]                 // source list (draft)
  versions    PuzzleSetVersion[]
}

model PuzzleSetItem {
  id        String    @id @default(cuid())
  setId     String
  set       PuzzleSet @relation(fields: [setId], references: [id], onDelete: Cascade)
  puzzleId  String
  puzzle    Puzzle    @relation(fields: [puzzleId], references: [id])
  order     Int

  @@unique([setId, order])                     // unambiguous draft ordering, matches VersionItem
  @@index([setId])
}

// Immutable snapshot created at publish time. Assignments reference a version,
// so later edits to the set never mutate an in-flight assignment's contents.
// Deletion is RESTRICT once any assignment references it.
model PuzzleSetVersion {
  id        String   @id @default(cuid())
  setId     String
  set       PuzzleSet @relation(fields: [setId], references: [id], onDelete: Cascade)
  version   Int                                  // monotonic per set
  createdAt DateTime @default(now())

  items     PuzzleSetVersionItem[]
  assignments Assignment[]

  @@unique([setId, version])
}

model PuzzleSetVersionItem {
  id          String           @id @default(cuid())
  versionId   String
  version     PuzzleSetVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)
  puzzleId    String
  puzzle      Puzzle           @relation(fields: [puzzleId], references: [id])
  order       Int

  @@unique([versionId, order])
  @@unique([versionId, puzzleId])
  @@index([versionId])
}

model Assignment {
  id          String           @id @default(cuid())
  versionId   String
  version     PuzzleSetVersion @relation(fields: [versionId], references: [id], onDelete: Restrict)
  studentId   String
  student     Student          @relation(fields: [studentId], references: [id], onDelete: Cascade)
  dueDate     DateTime?
  createdAt   DateTime         @default(now())
  progress    Int              @default(0)       // denormalized; derived from items
  completed   Boolean          @default(false)   // denormalized; derived from items
  items       AssignmentItemProgress[]
  attempts    Attempt[]

  @@unique([versionId, studentId])
  @@index([studentId])
}

// Per-item progress, materialized at assignment creation (one per version item).
model AssignmentItemProgress {
  id           String     @id @default(cuid())
  assignmentId String
  assignment   Assignment @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  puzzleId     String
  puzzle       Puzzle     @relation(fields: [puzzleId], references: [id], onDelete: Cascade)
  order        Int
  solved       Boolean    @default(false)
  attempts     Int        @default(0)
  firstSolvedAt DateTime?

  @@unique([assignmentId, puzzleId])
  @@index([assignmentId])
}

// ─── Attempts: one record PER PRESENTATION (not per puzzle) ───
// State machine: PENDING → {SOLVED | FAILED | SKIPPED | ABANDONED}, terminal.
// The PENDING Attempt itself is the issuance reservation — no separate table.
// One PENDING per student enforced by partial unique index (migration):
//   CREATE UNIQUE INDEX one_pending_attempt ON "Attempt"("studentId") WHERE status = 'PENDING'
enum AttemptStatus { PENDING SOLVED FAILED SKIPPED ABANDONED }

model Attempt {
  id            String        @id @default(cuid())
  studentId     String
  student       Student       @relation(fields: [studentId], references: [id], onDelete: Cascade)
  puzzleId      String
  puzzle        Puzzle        @relation(fields: [puzzleId], references: [id])
  assignmentId  String?
  assignment    Assignment?   @relation(fields: [assignmentId], references: [id], onDelete: SetNull)
  assignmentItemId String?                      // which AssignmentItemProgress this serves
  status        AttemptStatus @default(PENDING)
  moveIndex     Int           @default(0)       // cursor: next solution ply the student owes
  revision      Int           @default(0)       // increments per accepted command (concurrency guard)
  solved        Boolean       @default(false)   // true iff status = SOLVED
  usedHint      Boolean       @default(false)
  hintMove      String?                         // the revealed move (one hint per attempt)
  usedSkip      Boolean       @default(false)
  failCount     Int           @default(0)
  isReplay      Boolean       @default(false)   // set at issuance if puzzle already in StudentPuzzle
  coinsAwarded  Int           @default(0)
  timeSpentMs   Int?
  createdAt     DateTime      @default(now())
  finalizedAt   DateTime?

  ratingEvent   RatingEvent?

  @@index([studentId, createdAt])
  @@index([puzzleId])
  @@index([assignmentId])
  @@index([status])
}

// ─── Daily goals & streaks (timezone-correct) ───
model DailyProgress {
  studentId String
  date      DateTime @db.Date                     // local date (date-only), not a timestamp
  student   Student @relation(fields: [studentId], references: [id], onDelete: Cascade)
  solvedCount Int     @default(0)
  goalMet      Boolean @default(false)
  goalBonusAwarded Boolean @default(false)       // idempotency flag

  @@id([studentId, date])
  @@index([date])
}

// ─── Gamification: append-only ledger + badges ───
// BALANCES ARE CACHES, derived from the ledger by two distinct invariants:
//   coinBalance   = SUM(amount)                          // signed: spends reduce it
//   lifetimeCoins = SUM(amount) WHERE amount > 0          // earnings only, never decreases
// Every credit AND every debit appends a ledger row in the SAME transaction
// that mutates the balance. Ledger inserts use ON CONFLICT ("idempotencyKey")
// DO NOTHING RETURNING id — NOT Prisma create(), which throws and aborts on collision.
enum CoinReason { SOLVE SOLVE_HINTED GOAL_BONUS STREAK_BONUS PURCHASE_HINT PURCHASE_SKIP }

model CoinTransaction {
  id            String     @id @default(cuid())
  studentId     String
  student       Student    @relation(fields: [studentId], references: [id], onDelete: Cascade)
  amount        Int                                 // +earn / -spend (always signed)
  reason        CoinReason
  idempotencyKey String   @unique                   // business key — see Entitlement Keys
  refId         String?                             // attemptId / assignmentId
  createdAt     DateTime   @default(now())

  @@index([studentId, createdAt])
}

model StudentBadge {
  id        String   @id @default(cuid())
  studentId String
  student   Student  @relation(fields: [studentId], references: [id], onDelete: Cascade)
  badgeKey  String
  awardedAt DateTime @default(now())

  @@unique([studentId, badgeKey])
}

// ─── Rating history for dashboard trend charts ───
enum RatingOutcome { SOLVED FAILED }

model RatingEvent {
  id        String        @id @default(cuid())
  studentId String
  student   Student       @relation(fields: [studentId], references: [id], onDelete: Cascade)
  rating    Int                                     // snapshot of inAppRating after the attempt
  outcome   RatingOutcome
  delta     Int                                     // signed change applied this event
  attemptId String        @unique                   // 1:1 with the attempt
  attempt   Attempt      @relation(fields: [attemptId], references: [id], onDelete: Cascade)
  createdAt DateTime      @default(now())

  @@index([studentId, createdAt])
}
```

**Key design points:**
- No `passwordHash` in app models — Better Auth owns it.
- `Attempt` is a per-presentation record with an explicit state machine. The PENDING Attempt is the reservation — no separate `AttemptReservation` table.
- `isReplay` is set at issuance time by checking if the puzzle exists in `StudentPuzzle` — no pair-level claim infrastructure.
- `hintMove` stored on Attempt — one hint per attempt, no solution leaking.
- `StudentPuzzle` written only on SOLVED — abandonment doesn't poison anti-repeat.
- `DailyProgress.date` is `DateTime @db.Date` — timezone-correct streaks.
- `PuzzleSetVersion` has normalized items only (no JSON snapshot); `@@unique([setId, version])`, `@@unique([versionId, order])`, `@@unique([versionId, puzzleId])`.
- Ledger uses `ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id` — collisions are a detectable no-op, not an exception.
- No `Unlock` model — hints and skips are pay-at-use, no inventory.
- No `AcceptedCommand` model — `revision` + conditional updates handle concurrency.

## Server-Authoritative Solve Protocol

The client must **never** learn the solution, and must **never** decide the outcome. Three operations: **issue**, **move**, **spend**.

### Issuing a puzzle — `/next` returns existing PENDING or creates one

**One PENDING attempt per student** (enforced by partial unique index). On `/next`:
1. `SELECT … FOR UPDATE` on the Student row (prevents parallel issuance).
2. Check for an existing PENDING attempt for this student:
   - **No `assignmentId` in the request** (auto-queue): if any PENDING attempt exists, return it.
   - **`assignmentId` in the request**: if a PENDING attempt exists **for that same assignment**, return it. If a PENDING attempt exists for a *different* assignment or for auto-queue, mark it `ABANDONED` (it awards nothing) and proceed to issue a new one for the requested assignment.
3. If no matching PENDING attempt exists:
   - **Auto-queue:** run the anti-repeat selection query (NOT EXISTS against `StudentPuzzle`), create a PENDING `Attempt` with `isReplay` set from whether the puzzle is in `StudentPuzzle`.
   - **Assigned set:** the route accepts only an `assignmentId`. Server verifies the assignment belongs to the student, picks the lowest-`order` `AssignmentItemProgress` with `solved = false`, derives `puzzleId` and `assignmentItemId` from it, creates the PENDING `Attempt`.
4. Response is an **opaque presentation**:
```ts
{
  attemptId: "cuid",
  fen: "...",                 // current board FEN — startFen advanced through moveIndex (== startFen for a fresh attempt)
  sideToMove: "white" | "black",
  themes: [...],              // display only
  expectedRevision: 0,        // the revision the server expects on the next command
}
```
**`solutionMoves` is never sent to the client.** The server reconstructs `fen` by replaying `solutionMoves[0..moveIndex-1]` (student + opponent plies) from `startFen` via `chess.js`. An attempt PENDING past a TTL (e.g. 2h) is swept to `ABANDONED` by a cron; it awards nothing and the puzzle can be re-served.

### Submitting a move — revision-based concurrency

Client posts `{ attemptId, move: "e2e4", expectedRevision: n }`. Server:
1. Loads the `Attempt` (must be owned by the session student, must be PENDING).
2. **Conditional update** — only proceeds if `status = PENDING AND revision = expectedRevision`. A concurrent command that already advanced `revision` causes a `409 revision_mismatch` (client refreshes attempt state).
3. Validates `move` against `solutionMoves[moveIndex]` via server-side `chess.js`:
   - **Illegal move** (not legal chess) → `{ status: "illegal" }`, no state change.
   - **Legal but wrong** → increment `failCount`, advance `revision`. If `failCount >= FAIL_LIMIT` (default 2), finalize as `FAILED`. Otherwise respond `{ status: "incorrect", failCount }`.
   - **Correct & not terminal** → apply, auto-apply opponent reply, advance `moveIndex` by 2, advance `revision`. Respond `{ status: "continue", expectedRevision, opponentMove: "e7e5", fen: "..." }` — `opponentMove` is the UCI the server auto-played, `fen` is the resulting position after both plies.
   - **Correct & terminal** → finalize as `SOLVED`.

### Finalize (SOLVED) — one atomic transaction

`UPDATE Attempt SET status='SOLVED', solved=true, finalizedAt=now(), revision=revision+1 WHERE id=? AND status='PENDING'` gates entry. Then in the **same transaction**:
1. **Ledger credit via `ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id`** with key `solve:{studentId}:{puzzleId}`:
   - **Row returned** (first-ever solve): increment `coinBalance` and `lifetimeCoins` by `$reward` (`usedHint ? 5 : 10`), set `Attempt.coinsAwarded`.
   - **No row** (replay): award no coins, `coinsAwarded = 0`.
2. **Write `StudentPuzzle`** (permanent anti-repeat) — only on solve. `ON CONFLICT DO UPDATE SET lastSeenAt = now(), timesSeen = timesSeen + 1`.
3. Upsert `DailyProgress` (local date): `solvedCount += 1`. If `solvedCount >= dailyGoal` and not `goalBonusAwarded`, set it true and append `+50 GOAL_BONUS` keyed `goal:{studentId}:{date}` (same ON CONFLICT pattern).
4. **Rating update:** `SELECT … FOR UPDATE` on Student, compute Elo delta. **Replay solves (`isReplay = true`) skip Elo entirely — no RatingEvent, no rating change.** First solves apply Elo with `actual = 1`. `UPDATE Student SET inAppRating = inAppRating + delta`, insert `RatingEvent(outcome: SOLVED, delta, attemptId)`.
5. If `assignmentItemId` set: conditional `UPDATE AssignmentItemProgress SET solved=true, firstSolvedAt=now() WHERE id=? AND solved=false` (atomic flip — 0 rows means another solve already flipped it). If a flip occurred, **atomically increment** `UPDATE Assignment SET progress = progress + 1 WHERE id = ?` (never count-and-set, which loses updates under concurrent solves on different items). Set `completed` conditionally: `UPDATE Assignment SET completed = true WHERE id = ? AND progress = (SELECT count(*) FROM "PuzzleSetVersionItem" WHERE "versionId" = $versionId)`.
6. **Streak check:** count consecutive met days (from `DailyProgress`) ending today. If streak reaches 7 and no `CoinTransaction` with key `streak:{studentId}:7` exists, append `+100 STREAK_BONUS` (same `ON CONFLICT` pattern), increment `coinBalance`/`lifetimeCoins`. Repeat for 30-day milestone (`streak:{studentId}:30`). No-op if already awarded.
7. Evaluate badges via idempotent upserts.

### Failure — rating can go DOWN

- **FAILED** — `failCount` reaches `FAIL_LIMIT`. Conditional `status` update, then in same tx: if `isReplay`, skip Elo (no RatingEvent — consistent with the replay rule, since the puzzle was already rated on its first solve). Otherwise `SELECT … FOR UPDATE` Student, apply Elo with `actual = 0` (rating drops), insert `RatingEvent(outcome: FAILED, delta, attemptId)`. No coins, no `StudentPuzzle` write. Increment `AssignmentItemProgress.attempts` if assigned (unconditionally — assignment progress tracks engagement, not rating).
- **SKIPPED** — see Spend. No Elo change, no reward, streak-neutral.
- **ABANDONED** — TTL sweep. No Elo, no reward, no streak impact.

**Replay rule (simple):** `isReplay` is set at issuance by checking `StudentPuzzle` existence. Replay solves skip Elo and coins entirely. Non-replay failures and solves each produce a RatingEvent with their respective Elo delta. A student who fails twice then solves gets 2 negative + 1 positive update — that's coherent per-attempt Elo behavior, not corruption.

### Entitlement idempotency keys

| Event | `idempotencyKey` | Effect on collision |
|---|---|---|
| First solve of a puzzle | `solve:{studentId}:{puzzleId}` | No credit (replay) |
| Daily goal hit | `goal:{studentId}:{date}` | No bonus |
| 7-day streak | `streak:{studentId}:7` | No bonus |
| 30-day streak | `streak:{studentId}:30` | No bonus |
| Hint purchase | `hint:{attemptId}` | No charge, return revealed move |
| Skip purchase | `skip:{attemptId}` | No charge, return already-SKIPPED |

All inserts use `ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id`.

### Spending — hint / skip (balance check FIRST, then mutate)

Every spend is a single transaction that **gates on `status = 'PENDING'` first**, then checks balance, and rolls back on insufficient funds:

1. **Hint (15 coins):** `POST /api/attempts/{id}/hint`.
   - Load attempt. If `status != 'PENDING'` → `409 attempt_not_pending` (finalized or abandoned — no charge).
   - If `Attempt.usedHint` is already true → return `Attempt.hintMove` (idempotent, no charge).
   - Conditional balance check: `UPDATE Student SET coinBalance = coinBalance - 15 WHERE id = ? AND coinBalance >= 15 RETURNING id`. If 0 rows → `402 insufficient_funds`, transaction rolls back, **no state mutated**.
   - On success: insert `CoinTransaction(-15, PURCHASE_HINT, "hint:{attemptId}")` via `ON CONFLICT DO NOTHING RETURNING`, set `Attempt.usedHint = true` and `Attempt.hintMove = solutionMoves[moveIndex]`. Return the revealed move. **Cursor does not advance** — the student still must play it.
2. **Skip (30 coins):** `POST /api/attempts/{id}/skip`.
   - Load attempt. If `status = 'SKIPPED'` → return idempotent `{ status: "skipped" }` (no charge). If `status` is any other non-PENDING value → `409 attempt_not_pending`.
   - Conditional balance check (same pattern, cost 30). 0 rows → `402`, rollback.
   - On success: ledger row `skip:{attemptId}`, finalize attempt as `SKIPPED` (`status='SKIPPED', usedSkip=true, finalizedAt=now() WHERE status='PENDING'`). No Elo, no `StudentPuzzle`, streak-neutral.

### Concurrency summary

| Race | Guard |
|---|---|
| Double `/next` (or page refresh) | Student-row `FOR UPDATE` + partial unique index `one_pending_attempt`; `/next` returns existing PENDING |
| Parallel move submissions on one attempt | `WHERE status='PENDING' AND revision=expected` conditional update |
| Double finalize of one attempt | `WHERE status='PENDING'` conditional update |
| Same puzzle solved via two attempts | Entitlement key `solve:{studentId}:{puzzleId}` + `ON CONFLICT DO NOTHING RETURNING` |
| Cross-attempt concurrent finalize corrupting rating | `SELECT … FOR UPDATE` on Student row before Elo write |
| Replay-solve inflating rating | `isReplay` set at issuance → rating step skipped |
| Hint/skip charging on finalized attempt | `WHERE status='PENDING'` gate in same tx as charge |
| Hint/skip with insufficient funds | Balance check first; 0 rows → rollback, no partial state |
| Double hint charge | `usedHint` already true → return stored `hintMove`, no charge |
| Invite over-redemption | `UPDATE InviteCode SET uses = uses + 1 WHERE id = ? AND uses < maxUses` (0 rows → rejected) |

## Puzzle Selection Logic

### Path A — Assigned sets
Student opens an `Assignment` → `/next?assignmentId=…` → server picks the lowest-`order` `AssignmentItemProgress` with `solved = false`, derives `puzzleId` from it, creates PENDING `Attempt`. Retries allowed; tracked in `AssignmentItemProgress.attempts`.

### Path B — Auto-queue ("Daily Practice")
1. Read `inAppRating`, `ratingK`.
2. Compute window `[inAppRating - margin, inAppRating + margin]`; `margin` starts wide (e.g. ±250) and narrows as rating events accrue.
3. **Anti-repeat via correlated `NOT EXISTS`:**
   ```sql
   SELECT p.* FROM "Puzzle" p
   WHERE p.rating BETWEEN $lo AND $hi
     AND NOT EXISTS (SELECT 1 FROM "StudentPuzzle" sp
                     WHERE sp."puzzleId" = p.id AND sp."studentId" = $student)
   ORDER BY p.popularity DESC
   LIMIT 50;
   ```
4. **Fallback ladder** if the window is exhausted:
   - Widen the window in steps (±250 → ±400 → ±600).
   - If still empty, allow **least-recently-seen** puzzles (reuse `StudentPuzzle.lastSeenAt`).
   - If still empty, return a "queue complete" state.

## Rating Formula

A documented Elo approximation. External and in-app ratings stay separate; Lichess puzzle rating is a **prior used only to initialize** `inAppRating` at link time.

- Expected score: `E = 1 / (1 + 10^((puzzleRating - inAppRating)/400))`
- Update: `inAppRating += K * (actual - E)`, where `actual ∈ {1 win, 0 loss}` and `K = ratingK`.
- `ratingK` starts at 40 and steps down as rated attempts accrue (40 → 32 → 24 at 30/100/300 rated attempts).
- `puzzleRating` is the puzzle's stored Lichess rating (a fixed property of the puzzle).
- **Replay solves (`isReplay = true`) skip Elo entirely** — no RatingEvent, no rating change.
- FAILED attempts apply Elo with `actual = 0` (rating drops). SKIPPED and ABANDONED do not affect Elo.
- All rating updates are serialized by `SELECT … FOR UPDATE` on the Student row.
- Nightly Lichess sync updates `lichessPuzzleRating`/`lichessGameRating` **only** — never touches `inAppRating`.

### Calibration (no Lichess)
Students without Lichess start at `inAppRating = 1500` with `ratingK = 40` (high volatility). The wide initial selection window (±250) and high K-factor serve as calibration — the rating adapts quickly from the first ~30 solves. No separate calibration set is needed.

## Gamification Rules

### Earning (append-only ledger)
| Event | Coins | Idempotency key |
|---|---|---|
| Solve (no hint) | +10 | `solve:{studentId}:{puzzleId}` |
| Solve with hint | +5 | `solve:{studentId}:{puzzleId}` |
| Fail | 0 | — (but Elo applies `actual = 0`) |
| Hit daily goal | +50 | `goal:{studentId}:{date}` |
| 7-day streak milestone | +100 | `streak:{studentId}:7` |
| 30-day streak milestone | +250 | `streak:{studentId}:30` |

Solve reward is keyed on the puzzle, not the attempt — replay solves credit nothing. Failures feed `actual = 0` into Elo.

### Spending (balance check first, rollback on insufficient)
| Power-up | Cost | Effect |
|---|---|---|
| Hint | 15 | Server reveals the next correct move (one hint per attempt, stored in `hintMove`) |
| Skip | 30 | Marks attempt SKIPPED, no reward, no Elo, streak-neutral |

### Streaks (DailyProgress-derived)
A day is "met" when `DailyProgress.solvedCount >= dailyGoal` for that student's local date. Streak = count of consecutive met days ending today (or yesterday if today not yet met). Immune to double goal-bonus via `goalBonusAwarded`. Correct across local midnight and DST because boundaries use the student's IANA timezone.

### Badges (idempotent upserts)
Checked at finalize:
- `first_solve` — first solved attempt ever.
- `streak_7` / `streak_30` — current streak reaches 7 / 30.
- `centurion` — lifetime solved count ≥ 100.
- `sharpshooter` — last 10 attempts all solved.
- `theme_master_<theme>` — 20 solved attempts on puzzles whose `themes` contains `<theme>`.
- `comeback` — an attempt solved immediately following 3 consecutive failed attempts.

Upsert keyed on `(studentId, badgeKey)` — awarding twice is a no-op.

### Leaderboard
Ranks the tutor's students by `lifetimeCoins DESC`, tie-broken by (solved count DESC, student id ASC). Display names only.

## Lichess Integration

### OAuth — PKCE (no client secret, no refresh token)
1. Student clicks "Connect Lichess" → server generates PKCE verifier + S256 challenge, stores verifier in a short-lived HttpOnly SameSite cookie, redirects to `lichess.org/oauth?response_type=code&client_id=…&code_challenge_method=S256&code_challenge=…&scope=&redirect_uri=…&state=…`. **Scope is empty** — `/api/account`'s `perfs` are readable with no special scope.
2. Lichess redirects back with `code` + `state` (state validated against cookie).
3. Server exchanges `code` + verifier at `lichess.org/api/token` (no client secret). Receives `access_token`.
4. Server calls **`GET /api/account` once** — the `perfs` object contains ratings for `puzzle`, `rapid`, `blitz`.
5. Persist `lichessId`, `lichessUsername`, and ratings to `LichessConnection` + `Student.lichessPuzzleRating`/`lichessGameRating`. **Discard the token.**
6. **Init guard:** initialize `inAppRating` from the prior **only if no `RatingEvent` exists yet** (`lichessPuzzleRating` → else `lichessGameRating` → else leave at 1500). Protects students who practiced before linking.

### Nightly sync (CRON_SECRET-protected)
For each linked student, `GET /api/user/{username}` (public, no token) → refresh `lichessPuzzleRating`/`lichessGameRating`. Handles 429 with backoff; failures leave previous values intact. Runs on Vercel Cron with a `CRON_SECRET` header.

### Puzzle import (`prisma/scripts/import-puzzles.ts`, run locally or in CI)
- Source: `https://database.lichess.org/lichess_db_puzzle.csv.zst` (Zstandard).
- Stream-decompress, parse CSV stream.
- **Apply the opponent's setup move:** CSV `Moves` is `oppUCI studentUCI …`. First move is opponent's; apply to FEN with `chess.js` to produce `startFen`. Store `solutionMoves` starting from student's move. Skip invalid lines.
- Filter: rating 400–2300, popularity > 0.
- **Bulk load via PostgreSQL `COPY`** into staging table, then `INSERT … ON CONFLICT (id) DO NOTHING`. Resumable/idempotent.
- Result: ~150K–300K curated rows.

## Serverless & Database Notes

- Use Neon's **pooled** connection string for Prisma in deployment.
- Co-locate app and DB regions; keep transactions short.
- Check constraints: `coinBalance >= 0`, `lifetimeCoins >= 0` (enforced in app via conditional updates; DB-level checks as backstop).
- Partial unique index in migration: `CREATE UNIQUE INDEX one_pending_attempt ON "Attempt"("studentId") WHERE status = 'PENDING'`.

## Application Pages

### Auth
- `/login`, `/signup` — email/password. Signup requires a valid invite code. No public tutor signup.
- `/connect-lichess` — starts the PKCE flow; optional.

### Student (`(student)`) — all guarded by `requireStudent()`
- `/dashboard` — `inAppRating`, streak, daily goal progress, coin balance, assigned sets, "Start Practice". Rating trend from `RatingEvent`; last-active from latest `Attempt.createdAt`.
- `/practice` — auto-queue solver; opaque puzzle fetch, incremental move validation, hint/skip buttons, coin animation.
- `/sets/[assignmentId]` — assigned set solver (same board, version-backed items).
- `/leaderboard` — class ranking, display names, deterministic tie-breakers.
- `/profile` — Lichess connection, badges, stats.

### Tutor (`(tutor)`) — all guarded by `requireTutor()`, every query scoped by `tutorId`
- `/roster` — students (display name, `inAppRating`, streak, last-active, assignment progress).
- `/students/[id]` — solve history, accuracy by theme, rating trend, badges. 404 if `student.tutorId !== tutor.id`.
- `/sets` — CRUD for manual puzzle sets; publish materializes a `PuzzleSetVersion`.
- `/assign` — assign a version to a student or the whole roster; due date.
- `/goals` — set `dailyGoal` per student or class-wide.
- `/invites` — generate invite codes.

### API routes
- `/api/auth/lichess/*` — PKCE callbacks.
- `/api/puzzles/next` — opaque fetch (returns existing PENDING or creates one).
- `/api/attempts/{id}/move` — submit move (revision-based concurrency).
- `/api/attempts/{id}/hint` — hint purchase (balance check first).
- `/api/attempts/{id}/skip` — skip purchase (balance check first).
- `/api/cron/sync-lichess` — CRON_SECRET-protected nightly rating sync.
- `/api/cron/sweep-attempts` — CRON_SECRET-protected PENDING→ABANDONED TTL sweep.

## Verification Gates (tests to write before "done")

1. **Prisma validates:** `prisma validate` passes; migration generates cleanly.
2. **Page refresh resumes:** `/next` with an existing PENDING attempt returns it (not a new puzzle).
3. **Double finalize:** two simultaneous finalizes of the same attempt grant exactly one reward (conditional `status` update).
4. **Parallel moves:** two concurrent move submissions — exactly one advances `revision`, the other gets `409`.
5. **Entitlement:** abandon a puzzle, re-open it, solve it — solve coins credit exactly once (`solve:{studentId}:{puzzleId}`).
6. **Replay neutrality:** solving an already-solved puzzle awards no coins and creates no `RatingEvent`.
7. **Rating goes down:** a FAILED attempt applies Elo with `actual = 0` and `inAppRating` decreases.
8. **Authorization:** cross-tutor and cross-student IDs always return 404.
9. **Streaks:** correct across local midnight and DST (fixed-clock test with tz-aware dates).
10. **Queue fallback:** exhausted rating window widens → least-recently-seen → "queue complete".
11. **Lichess resilience:** 429 responses and interrupted imports resume without duplicates.
12. **Init guard:** linking Lichess after earning an in-app rating does not overwrite `inAppRating`.
13. **Solve integrity:** solution is never present in any response payload.
14. **Insufficient funds:** hint/skip with insufficient balance → `402`, no partial state (no ledger row, no flag flip).
15. **Hint idempotency:** second hint on same attempt returns stored `hintMove` without re-charging.
16. **Hint doesn't leak:** after advancing `moveIndex`, a second hint returns the original `hintMove`, not the new cursor's move.
17. **Invite atomicity:** concurrent redemptions cannot enroll more students than `maxUses`.
18. **Ledger integrity:** `SUM(amount) = coinBalance` and `SUM(amount WHERE amount > 0) = lifetimeCoins` after concurrent earn/spend.
19. **Assignment integrity:** attempt `puzzleId` is server-derived from the assignment, not client-supplied.
20. **Abandonment cleanliness:** abandoned attempt leaves no `StudentPuzzle` row (puzzle can be re-served).
21. **Board state on resume:** `/next` with an existing PENDING attempt at `moveIndex > 0` returns the correct mid-line FEN, not the original `startFen`.
22. **Assignment context switch:** `/next?assignmentId=A` with a PENDING auto-queue attempt abandons it and serves a puzzle from assignment A.
23. **Streak bonus awarded:** solving the 7th consecutive daily-goal-met day credits exactly one `+100 STREAK_BONUS` (repeat finalize does not double-credit).

## Open Questions / Future

- Glicko-2 precise rating (swap-in for the Elo formula; interface unchanged).
- FILTER-mode puzzle sets (theme/rating auto-generated sets).
- Bonus pack shop / power-up inventory.
- Streak-freeze power-up, cosmetics shop.
- Multi-class / multi-tenant (data model is forward-compatible).
- Mobile app (API surface is clean enough to support one later).
