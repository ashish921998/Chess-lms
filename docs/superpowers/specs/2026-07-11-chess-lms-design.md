# Chess Tutor LMS — Design Spec

**Date:** 2026-07-11
**Status:** Draft v2.1 (revised after two rounds of architecture review)
**Revision note:** v1 had blocking issues in auth schema, authorization, the attempt/reward model, and the server-side solve protocol. v2 corrected the Lichess OAuth flow, schema typing, and coin ledger, but left three true blockers: the `Attempt` model had no state machine, `StudentPuzzle` lacked its reverse Prisma relation, and the rating protocol had no defined failure event (infinite retries ⇒ rating only goes up). v2.1 adds an explicit `AttemptStatus` state machine with `moveIndex`/`finalizedAt`, a single-flight `/next` issuance protocol, business-level reward entitlement keys (so abandoning and re-opening a puzzle can't double-reward), rating failure rules, the missing Prisma relations and `@@unique` constraints, conditional-update concurrency control throughout, RESTRICT on published-content deletion, and a fully-specified hint/skip API contract.

A learning management system for a chess tutor and their students. The tutor assigns puzzles calibrated to each student's level; students solve them and earn coins, streaks, badges, and leaderboard rank. Puzzles and student ratings come from Lichess.

## Context & Scope

This build is for a single tutor running chess classes. **One class per tutor** for MVP — there is no `Class` entity; a tutor's roster *is* the class, and "class-wide" actions broadcast to all of the tutor's students. The data model accommodates multiple tutors for a future migration, but no multi-tenant UI or cross-tutor features are in scope.

### In scope (MVP)
- Email/password auth with **Tutor** and **Student** roles (Better Auth)
- Lichess OAuth (PKCE, optional): students may connect Lichess to sync ratings
- Curated-slice Lichess puzzle library imported into Postgres
- Two puzzle-serving paths: **tutor-curated sets** and an **auto-adaptive daily queue**
- Server-authoritative solve validation (client never sees the solution)
- Gamification: coins (earn + spend, append-only ledger), streaks, tutor-set daily goals, badges, per-tutor leaderboard
- Tutor dashboard: roster, student progress, puzzle set CRUD, assignment, goal-setting
- Student dashboard: practice, assigned sets, leaderboard, profile, power-up shop
- Students without Lichess: supported via in-app calibration

### Out of scope (MVP)
- Multi-class / multi-tenant platform features (data model is forward-compatible)
- Writing results back to the student's real Lichess account
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
| Lichess | Optional; calibration fallback for unlinked students |
| Coins | Earned (leaderboard) + spent (hints/skips/packs); append-only ledger |
| Leaderboard | Per-tutor; display names; deterministic tie-breakers |
| Daily goals | Tutor-set per student or class-wide |
| Puzzle selection | Blended: tutor-curated sets + auto-adaptive queue |

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
│   │       └── cron/*            # CRON_SECRET-protected nightly sync
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
- **Tutor is seeded administratively** (`prisma/scripts/seed-tutor.ts`). There is no public "sign up as tutor" path — this prevents anyone from creating a tenant.
- **Students enroll via invitation codes.** The tutor generates single-use (or multi-use) codes from their dashboard; the signup form requires a valid code. The code binds the new student to the generating tutor.
- A student may operate **without linking Lichess** (see Calibration).

### Authorization guards
Every route and API handler resolves the authenticated user to a `Student` or `Tutor` profile, then scopes **all** queries through that profile:
- `requireTutor()` — returns the tutor profile or 401.
- `requireStudent()` — returns the student profile or 401.
- Any by-ID access (student profile, assignment, attempt) is filtered by `tutorId` (tutor context) or `id === session.student.id` (student context). A record that exists but belongs to another tutor/student returns **404**, not 403 (no existence leak).

### Privacy & deletion
- Leaderboards use **display names** (set by student/tutor, never auto-derived from the email local-part), never emails.
- Better Auth email verification and password reset are enabled.
- **Student deletion** cascades to attempts, daily progress, unlocks, badges, coin ledger, rating events, and `StudentPuzzle` — all student-owned data is purged.
- **Published content is archival, not destroyable:** `PuzzleSetVersion` is `onDelete: Restrict` from `Assignment` (you can't delete a version an assignment depends on). The coin ledger is append-only; a "refund" is a compensating row, never a delete. A tutor requesting deletion of a published set soft-archives it (hidden flag) rather than cascading.

## Data Model (Prisma)

Better Auth-generated models (`user`, `session`, `account`, `verification`) are omitted below; only app models are shown. The Lichess link lives in a custom `LichessConnection` (not Better Auth's generic `account`, since Lichess tokens are app-managed and short-lived in our flow).

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
  lifetimeCoins       Int     @default(0)    // leaderboard, immutable-ish
  dailyGoal           Int     @default(5)    // tutor-set

  lichess             LichessConnection?
  attempts            Attempt[]
  seenPuzzles         StudentPuzzle[]            // reverse relation (was missing in v2)
  dailyProgress       DailyProgress[]
  assignments         Assignment[]
  unlocks             Unlock[]
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
  // token is short-lived in our flow: used once to read ratings, then discarded.
  // re-linking re-authorizes. (Lichess tokens don't expire, but we don't retain them.)
  lastSyncedAt    DateTime?
}

model InviteCode {
  id        String    @id @default(cuid())
  tutorId   String
  tutor     Tutor     @relation(fields: [tutorId], references: [id], onDelete: Cascade)
  code      String    @unique
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
  setVersions   PuzzleSetVersionItem[]
  attempts      Attempt[]
  seenBy        StudentPuzzle[]

  @@index([rating])
  @@index([popularity])
}

// Anti-repeat + "seen" state, decoupled from attempts (one record per student+puzzle)
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

// ─── Tutor sets: manual OR filter; published as immutable versions ───
enum PuzzleSetMode { MANUAL FILTER }

model PuzzleSet {
  id          String       @id @default(cuid())
  tutorId     String
  tutor       Tutor        @relation(fields: [tutorId], references: [id], onDelete: Cascade)
  title       String
  description String?
  mode        PuzzleSetMode
  // FILTER-mode params (ignored when MANUAL)
  themeFilter String[]     @default([])
  ratingMin   Int?
  ratingMax   Int?
  targetCount Int?                            // how many to materialize on publish
  isPublished Boolean       @default(false)
  createdAt   DateTime      @default(now())

  items       PuzzleSetItem[]                 // MANUAL-mode source list (draft)
  versions    PuzzleSetVersion[]
  assignments Assignment[]
}

model PuzzleSetItem {
  id        String    @id @default(cuid())
  setId     String
  set       PuzzleSet @relation(fields: [setId], references: [id], onDelete: Cascade)
  puzzleId  String
  puzzle    Puzzle    @relation(fields: [puzzleId], references: [id])
  order     Int
}

// Immutable snapshot created at publish time. Assignments reference a version,
// so later edits to the set (or changes to FILTER results) never mutate an
// in-flight assignment's contents. Deletion is RESTRICT once any assignment
// references it (published content is archival, not destroyable).
model PuzzleSetVersion {
  id        String   @id @default(cuid())
  setId     String
  set       PuzzleSet @relation(fields: [setId], references: [id], onDelete: Cascade)
  version   Int                                  // monotonic per set
  snapshot  Json                                   // materialized {puzzleId, order}[]
  createdAt DateTime @default(now())

  items     PuzzleSetVersionItem[]
  assignments Assignment[]

  @@unique([setId, version])                      // no concurrent-publish collision
}

model PuzzleSetVersionItem {
  id          String           @id @default(cuid())
  versionId   String
  version     PuzzleSetVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)
  puzzleId    String
  puzzle      Puzzle           @relation(fields: [puzzleId], references: [id])
  order       Int

  @@unique([versionId, order])                    // one puzzle per slot
  @@unique([versionId, puzzleId])                 // no dup puzzle in a version
}

model Assignment {
  id          String           @id @default(cuid())
  versionId   String                              // points at immutable version
  version     PuzzleSetVersion @relation(fields: [versionId], references: [id], onDelete: Restrict)
  studentId   String
  student     Student          @relation(fields: [studentId], references: [id], onDelete: Cascade)
  dueDate     DateTime?
  createdAt   DateTime         @default(now())
  progress    Int              @default(0)
  completed   Boolean          @default(false)
  items       AssignmentItemProgress[]
  attempts    Attempt[]                         // reverse relation

  @@unique([versionId, studentId])
}

// Per-item progress for an assignment — a puzzle can be attempted many times,
// independently tracked here. Completion = solved at least once. Rows are
// materialized at assignment creation time (one per version item), so "unsolved"
// always exists as a row and concurrent counting is unambiguous.
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
}

// ─── Attempts: one record PER PRESENTATION (not per puzzle) ───
// State machine: PENDING → {SOLVED | FAILED | SKIPPED | ABANDONED}, terminal.
// Finalization is a one-way transition guarded by a conditional update
// (WHERE status = PENDING) so a concurrent finalize on the same row is a no-op.
enum AttemptStatus { PENDING SOLVED FAILED SKIPPED ABANDONED }

model Attempt {
  id            String        @id @default(cuid())
  studentId     String
  student       Student       @relation(fields: [studentId], references: [id], onDelete: Cascade)
  puzzleId      String
  puzzle        Puzzle        @relation(fields: [puzzleId], references: [id])
  assignmentId  String?
  assignment    Assignment?   @relation(fields: [assignmentId], references: [id], onDelete: SetNull)
  status        AttemptStatus @default(PENDING)
  moveIndex     Int           @default(0)          // cursor: next solution ply the student owes
  solved        Boolean       @default(false)      // true iff status = SOLVED (denormalized for queries)
  usedHint      Boolean       @default(false)
  usedSkip      Boolean       @default(false)
  failCount     Int           @default(0)          // wrong-move submissions this attempt
  coinsAwarded  Int           @default(0)
  timeSpentMs   Int?
  createdAt     DateTime      @default(now())
  finalizedAt   DateTime?                          // set on first terminal transition

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

// ─── Gamification: append-only ledger + unlocks + badges ───
// BALANCES ARE CACHES. coinBalance/lifetimeCoins are always the signed sum of
// CoinTransaction.amount for that student. Every credit AND every debit appends
// a ledger row in the SAME transaction that mutates the balance, so the cache
// and ledger can never diverge. Idempotency is enforced by a UNIQUE constraint
// on a business key (see key scheme below), not just attemptId.
enum CoinReason {
  SOLVE
  SOLVE_HINTED
  GOAL_BONUS
  STREAK_BONUS
  PURCHASE_HINT
  PURCHASE_SKIP
  PURCHASE_PACK
}

model CoinTransaction {
  id            String     @id @default(cuid())
  studentId     String
  student       Student    @relation(fields: [studentId], references: [id], onDelete: Cascade)
  amount        Int                                 // +earn / -spend (always signed)
  reason        CoinReason
  idempotencyKey String   @unique                   // business key — see Entitlement Keys
  refId         String?                             // attemptId / assignmentId / versionId
  createdAt     DateTime   @default(now())

  @@index([studentId, createdAt])
}

model Unlock {
  id        String   @id @default(cuid())
  studentId String
  student   Student  @relation(fields: [studentId], references: [id], onDelete: Cascade)
  type      UnlockType
  refId     String?                            // bonus pack set version id
  remaining Int      @default(1)                // consumables decrement; packs stay
  createdAt DateTime @default(now())
  @@index([studentId, type])
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
model RatingEvent {
  id        String   @id @default(cuid())
  studentId String
  student   Student  @relation(fields: [studentId], references: [id], onDelete: Cascade)
  rating    Int                                   // snapshot of inAppRating after the attempt
  attemptId String?
  createdAt DateTime @default(now())
  @@index([studentId, createdAt])
}
```

**Key corrections from v2 review:**
- No `passwordHash` in app models — Better Auth owns it.
- `String[]?` → `String[] @default([])` (lists can't be optional).
- `Student` now declares the `seenPuzzles StudentPuzzle[]` reverse relation (was missing — schema wouldn't validate).
- `Attempt` is a per-**presentation** record with an explicit state machine (`AttemptStatus`, `moveIndex`, `finalizedAt`), not a per-puzzle unique row. Retries, comebacks, and re-practice all work.
- `Attempt.assignmentId` is a real FK to `Assignment` (was a dangling string); `AssignmentItemProgress.puzzleId` is a real FK to `Puzzle`.
- `AssignmentItemProgress` rows are **materialized at assignment creation** (one per version item), so "unsolved" always exists as a row and concurrent counts are unambiguous.
- Separate external (`lichessPuzzleRating`) vs in-app (`inAppRating`) ratings — never overwritten by sync.
- `PuzzleSetVersion` has `@@unique([setId, version])`; items have `@@unique([versionId, order])` and `@@unique([versionId, puzzleId])`. Published versions are `onDelete: Restrict` once assigned.
- `CoinTransaction` append-only ledger; **both credits and debits** append a row in the same tx that mutates the balance. Idempotency keys are **business-level entitlements**, not just `attemptId`.
- `DailyProgress` keyed by local date for timezone-correct streaks; `date` is `DateTime @db.Date`.

## Server-Authoritative Solve Protocol

The client must **never** learn the solution, and must **never** decide the outcome. Three operations — **issue**, **move**, **spend** — each have explicit concurrency control.

### Issuing a puzzle — single-flight `/next`
To prevent two parallel `/next` calls from creating two rewardable attempts for the same slot:
1. **Auto-queue:** before inserting a PENDING `Attempt`, the server runs the anti-repeat selection query inside a transaction and does a `SELECT … FOR UPDATE`-style lock on the chosen puzzle row *or* immediately writes the `StudentPuzzle` (studentId, puzzleId) row with `ON CONFLICT DO NOTHING` as the issuance claim. If `timesSeen` already covers this presentation window, the query re-selects. One puzzle → at most one PENDING attempt per student at a time.
2. **Assigned set:** the server picks the lowest-`order` `AssignmentItemProgress` row that is `solved = false`, locks it within the tx, and creates the PENDING `Attempt` pointing at it. A second concurrent call picks the *next* unsolved item (or returns the existing PENDING attempt for the same item if one exists — clients may reconnect to an in-flight attempt).
3. The response is an **opaque presentation**:
```ts
{
  attemptId: "cuid",
  startFen: "...",            // opponent setup move already applied
  sideToMove: "white" | "black",
  themes: [...],              // display only
  expectedMoveIndex: 0,       // the cursor the server expects on the next move submission
}
```
**`solutionMoves` is never sent to the client.** An attempt left PENDING past a TTL (e.g. 2 h) is swept to `ABANDONED` by a cron; it awards nothing and does not consume the puzzle slot (the student may be served it again later).

### Submitting a move — optimistic-cursor concurrency
Client posts `{ attemptId, move: "e2e4", expectedMoveIndex: n }`. Server:
1. Loads the `Attempt` (must be owned by the session student).
2. **Conditional update** — only proceeds if `status = PENDING AND moveIndex = expectedMoveIndex`. This makes parallel move submissions serialize: the second to arrive sees `moveIndex` already advanced and is told to refresh (`409 expected_index_mismatch`). No read-modify-write gap.
3. Validates `move` against `solutionMoves[moveIndex]` using a server-side `chess.js` instance constructed from `startFen` advanced through the already-played plies:
   - **Illegal move** (not a legal chess move) → `{ status: "illegal" }`, cursor unchanged, no state change.
   - **Legal but wrong** (not the solution move) → `{ status: "incorrect" }`, increment `failCount`. If `failCount >= FAIL_LIMIT` (default 2), finalize as `FAILED` (see Failure below). Otherwise the attempt stays PENDING for retry.
   - **Correct & not terminal** → apply it, auto-apply the next solution ply (opponent reply), advance `moveIndex` by 2, respond `{ status: "continue", expectedMoveIndex: moveIndex }`.
   - **Correct & terminal** → finalize as `SOLVED`.

### Finalize (SOLVED) — one atomic transaction
A conditional update `UPDATE Attempt SET status = 'SOLVED', solved = true, finalizedAt = now() WHERE id = ? AND status = 'PENDING'` gates entry — concurrent finalizes on the same row are no-ops. Then in the **same transaction**:
1. Insert `CoinTransaction` with `idempotencyKey = "solve:{studentId}:{puzzleId}"` (entitlement keys explained below) — `amount = usedHint ? 5 : 10`, reason accordingly. Add to `coinBalance` and `lifetimeCoins`. The UNIQUE constraint means only the first solve of a puzzle ever credits; replay-solves hit the constraint and skip the credit.
2. Upsert `DailyProgress` for the student's local date: `solvedCount += 1`. If `solvedCount >= dailyGoal` and not `goalBonusAwarded`, set `goalBonusAwarded = true` and append a `+50 GOAL_BONUS` txn (key `goal:{studentId}:{date}`).
3. Update `inAppRating` per the Elo formula (below), insert a `RatingEvent` snapshot, decay `ratingK` at solve-count thresholds.
4. If `assignmentId` is set: conditional update the matching `AssignmentItemProgress` (`solved = false → true`, `firstSolvedAt = now()`, `attempts += 1`), recompute `Assignment.progress`, set `completed` if all items solved.
5. Evaluate badges via idempotent upserts (keys below).

### Failure — rating must be able to go DOWN
A puzzle is recorded as `actual = 0` (a loss for Elo) **only** when the attempt transitions to `FAILED` or `SKIPPED`:
- **FAILED** — `failCount` reaches `FAIL_LIMIT`. Finalize: conditional `status` update, then in the same tx apply the Elo update with `actual = 0` (rating drops), insert a `RatingEvent` with a `failed` marker, increment `AssignmentItemProgress.attempts` (if assigned). No coin reward.
- **SKIPPED** — student spends a skip token (see Spend). Finalize: `status = SKIPPED`, `usedSkip = true`. **No Elo change** (skip is neutral — the student didn't engage), no reward, and it does **not** break a streak. It marks the `AssignmentItemProgress` as seen-but-unsolved (does not set `solved`).
- **ABANDONED** — TTL sweep. No Elo, no reward, no streak impact.

Because a fresh presentation gets a fresh attempt but rewards are keyed on **entitlements** (next), infinite retries cannot inflate rating upward without bound: the *first* solve credits once; subsequent presentations of an already-solved puzzle award no solve coins and apply Elo with diminishing weight (the puzzle is in `StudentPuzzle`, and re-solves are flagged `isReplay` so `ratingK` is lower-bounded and the rating effect is attenuated).

### Entitlement idempotency keys (business-level, not just attemptId)
The reward ledger is keyed on *what was earned*, not *which attempt earned it*:
| Event | `idempotencyKey` | Meaning |
|---|---|---|
| First solve of a puzzle | `solve:{studentId}:{puzzleId}` | Abandon + re-open + solve awards the solve bonus **once** |
| Daily goal hit | `goal:{studentId}:{date}` | Goal bonus once per local day |
| 7-day streak | `streak:{studentId}:7` | Milestone bonus once per lifetime (or per occurrence — see config) |
| Hint purchase | `hint:{attemptId}` | One charge per attempt |
| Skip purchase | `skip:{attemptId}` | One charge per attempt |
| Pack purchase | `pack:{studentId}:{versionId}` | One unlock per pack per student |

The `CoinTransaction.idempotencyKey UNIQUE` constraint enforces all of these. A second insert with the same key fails — so even if a puzzle is solved via two different attempts (e.g. abandoned then re-solved), the ledger credits exactly once. The `refId` column still carries the `attemptId` for traceability.

### Spending — hint / skip / pack
All three are conditional updates guarded by balance, and all append a ledger row **in the same transaction** as the balance decrement:
1. **Hint (15 coins):** `POST /api/attempts/{id}/hint` → conditional `UPDATE Student SET coinBalance = coinBalance - 15 WHERE id = ? AND coinBalance >= 15`. If 0 rows → 402 insufficient. On success, append `CoinTransaction(-15, PURCHASE_HINT, "hint:{attemptId}")`, set `Attempt.usedHint = true`, and **respond with the next correct move** for the current `moveIndex` (the cursor does not advance — the student still must play it). Idempotent on `hint:{attemptId}`: a second hint call on the same attempt is a no-op that returns the already-revealed move without re-charging.
2. **Skip (30 coins):** `POST /api/attempts/{id}/skip` → balance check + `CoinTransaction(-30, PURCHASE_SKIP, "skip:{attemptId}")`, then finalize as `SKIPPED` (neutral, see Failure). Idempotent on `skip:{attemptId}`.
3. **Bonus pack (100 coins):** `POST /api/shop/pack/{versionId}` → balance check + `CoinTransaction(-100, PURCHASE_PACK, "pack:{studentId}:{versionId}")`, insert an `Unlock(type = BONUS_PACK, refId = versionId, remaining = null)`.

### Concurrency summary (what makes each path safe)
| Race | Guard |
|---|---|
| Double `/next` → two rewardable attempts | Puzzle-row / `AssignmentItemProgress` lock inside the issuance tx; `StudentPuzzle` as claim |
| Parallel move submissions on one attempt | `WHERE status = PENDING AND moveIndex = expected` conditional update |
| Double finalize of one attempt | `WHERE status = PENDING` conditional update; `finalizedAt` set once |
| Same puzzle solved via two attempts | Entitlement key `solve:{studentId}:{puzzleId}` (UNIQUE) |
| Cross-attempt concurrent finalize corrupting rating/counts | `inAppRating` updated by signed delta via conditional `UPDATE … SET inAppRating = inAppRating + :delta`; `DailyProgress.solvedCount += 1` via conditional increment — both atomic |
| Double hint/skip charge | `hint:{attemptId}` / `skip:{attemptId}` UNIQUE keys |
| Insufficient funds on spend | `WHERE coinBalance >= cost` conditional update |
| Invite over-redemption | `UPDATE InviteCode SET uses = uses + 1 WHERE id = ? AND uses < maxUses` (0 rows → rejected) |

## Puzzle Selection Logic

### Path A — Assigned sets
Student opens an `Assignment` → serve the next `PuzzleSetVersionItem` whose `AssignmentItemProgress` is unsolved, lowest `order` first. Each presentation gets a fresh PENDING `Attempt`. Retries on a puzzle are allowed and tracked in `AssignmentItemProgress.attempts`.

### Path B — Auto-queue ("Daily Practice")
1. Read `inAppRating`, `ratingK`.
2. Compute window `[inAppRating - margin, inAppRating + margin]`; `margin` starts wide (e.g. ±250) and narrows as rating events accrue.
3. **Anti-repeat via correlated `NOT EXISTS`** (not a `NOT IN` list):
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
   - If still empty, return a "queue complete" state (surface to student — refresh later).
5. On finalize, nudge `inAppRating` per the rating formula below.

## Rating Formula

A documented Elo (not "simplified Glicko" hand-wave). External and in-app ratings stay separate; Lichess puzzle rating is a **prior used only to initialize** `inAppRating` at link time.

- Expected score: `E = 1 / (1 + 10^((puzzleRating - inAppRating)/400))`
- Update: `inAppRating += K * (actual - E)`, where `actual ∈ {1 win, 0 loss}` and `K = ratingK`.
- `ratingK` starts at 40 and steps down as attempts accrue (40 → 32 → 24 at 30/100/300 solves), so early volatility calms over time.
- `puzzleRating` is the puzzle's stored Lichess rating (a fixed property of the puzzle, not the student).
- Nightly Lichess sync updates `lichessPuzzleRating`/`lichessGameRating` **only** — never touches `inAppRating`.

## Gamification Rules

### Earning (append-only ledger entries)
| Event | Coins | Idempotency key (business-level) |
|---|---|---|
| Solve (no hint) | +10 | `solve:{studentId}:{puzzleId}` |
| Solve with hint | +5 | `solve:{studentId}:{puzzleId}` |
| Fail | 0 | — (but Elo applies `actual = 0`) |
| Hit daily goal | +50 | `goal:{studentId}:{date}` |
| 7-day streak milestone | +100 | `streak:{studentId}:7` |

**The solve reward is keyed on the puzzle, not the attempt** — abandoning and re-opening the same puzzle cannot double-credit. Failures award no coins but the attempt's `actual = 0` feeds the Elo update so the rating can move down. Retries are allowed; a replay-solve of an already-solved puzzle awards no coins and attenuated Elo (flagged `isReplay` via `StudentPuzzle.timesSeen`).

### Spending (conditional updates, balance ≥ cost)
| Power-up | Cost | Effect |
|---|---|---|
| Hint | 15 | Server reveals next correct move for the current attempt |
| Skip | 30 | Marks attempt seen, no reward, does not break streak |
| Bonus pack | 100 | Unlocks an extra themed `PuzzleSetVersion` |

### Streaks (DailyProgress-derived)
A day is "met" when `DailyProgress.solvedCount >= dailyGoal` for that student's local date. Streak = count of consecutive met days ending today (or yesterday if today not yet met). Computed from consecutive `DailyProgress` rows; immune to double goal-bonus via `goalBonusAwarded`. Correct across local midnight and DST because boundaries use the student's IANA timezone.

### Badges (idempotent upserts)
Precise definitions, checked at finalize:
- `first_solve` — first solved attempt ever.
- `streak_7` / `streak_30` — current streak reaches 7 / 30.
- `centurion` — lifetime solved count ≥ 100.
- `sharpshooter` — last 10 attempts all solved.
- `theme_master_<theme>` — 20 solved attempts on puzzles whose `themes` contains `<theme>` (a puzzle with multiple themes counts toward each).
- `comeback` — an attempt solved immediately following 3 consecutive failed attempts (requires multiple attempts; possible because retries are allowed).
Upsert keyed on `(studentId, badgeKey)` — awarding twice is a no-op.

### Leaderboard
Ranks the tutor's students by `lifetimeCoins DESC`, tie-broken by (solved count DESC, earliest `centurion`/achievement time, id ASC). Display names only.

## Lichess Integration

### OAuth — PKCE (no client secret, no refresh token)
1. Student clicks "Connect Lichess" → server generates a PKCE verifier + S256 challenge, stores verifier in the auth session, redirects to `lichess.org/oauth?response_type=code&client_id=…&code_challenge_method=S256&code_challenge=…&scope=&redirect_uri=…&state=…`. **Scope is empty** (or `email:read`) — `/api/account`'s `perfs` are readable with no special scope, and empty scope requests the least privilege.
2. Lichess redirects back with `code`.
3. Server exchanges `code` + verifier at `lichess.org/api/token` (no client secret). Receives a long-lived `access_token`.
4. Server calls **`GET /api/account` once** with the bearer token — the `perfs` object contains ratings for every variant including `puzzle`, `rapid`, `blitz`.
5. Persist `lichessId`, `lichessUsername`, and the ratings to `LichessConnection` + the student's `lichessPuzzleRating`/`lichessGameRating`. **Discard the token** (ratings are public; we don't need ongoing authenticated access).
6. **Init guard:** initialize `inAppRating` from the prior **only if no `RatingEvent` exists yet for this student** (`lichessPuzzleRating` → else `lichessGameRating` → else leave at 1500). This protects a student who linked Lichess after already earning an in-app rating from having their progress overwritten. Later syncs never touch `inAppRating`.

(There is no refresh token — Lichess doesn't issue one. Re-sync uses public `GET /api/user/{username}`; re-linking re-runs OAuth if needed.)

### Nightly sync (CRON_SECRET-protected)
For each linked student, `GET /api/user/{username}` (public, no token) → refresh `lichessPuzzleRating`/`lichessGameRating`. Handles 429 with backoff; failures leave previous values intact. Runs on Vercel Cron with a `CRON_SECRET` header.

### Puzzle import (`prisma/scripts/import-puzzles.ts`, run locally or in CI — never on Vercel)
- Source: `https://database.lichess.org/lichess_db_puzzle.csv.zst` (Zstandard, not bz2; ~4M+ rows total).
- Stream-decompress with `zstandard`, parse CSV stream.
- **Apply the opponent's setup move:** the CSV `Moves` field is `oppUCI studentUCI …`. The first move is the opponent's; apply it to the FEN with `chess.js` to produce `startFen`, and store `solutionMoves` starting from the student's move. Skip any puzzle whose move line fails to validate.
- Filter: rating 400–2300, popularity > 0.
- **Bulk load via PostgreSQL `COPY`** (not thousands of Prisma inserts) into a staging table, then `INSERT … ON CONFLICT (id) DO NOTHING` into `Puzzle`. Resumable/idempotent — re-running skips already-imported IDs.
- Result: ~150K–300K curated rows.

## Serverless & Database Notes

- Use Neon's **pooled** connection string for Prisma in deployment (or the Neon serverless adapter) to avoid exhausting connections on Vercel.
- Co-locate app and DB regions; keep transactions short (the finalize transaction is the longest-lived write path).
- All foreign keys get explicit `@@index` (Postgres does not auto-index FKs).
- Check constraints: `coinBalance >= 0`, `lifetimeCoins >= 0`, `remaining >= 0` (enforced in app via conditional updates; DB-level checks as backstop where supported).

## Application Pages

### Auth
- `/login`, `/signup` — email/password. Signup requires a valid invite code (binds student to a tutor). No public tutor signup.
- `/connect-lichess` — starts the PKCE flow; optional.

### Student (`(student)`) — all guarded by `requireStudent()`
- `/dashboard` — `inAppRating`, streak, daily goal progress (from `DailyProgress`), coin balance, assigned sets, "Start Practice". Rating trend from `RatingEvent`; last-active from latest `Attempt.createdAt`.
- `/practice` — auto-queue solver; opaque puzzle fetch, incremental move validation, hint/skip buttons, coin animation.
- `/sets/[assignmentId]` — assigned set solver (same board, version-backed items).
- `/leaderboard` — class ranking, display names, deterministic tie-breakers.
- `/profile` — Lichess connection, badges, stats, power-up shop.

### Tutor (`(tutor)`) — all guarded by `requireTutor()`, every query scoped by `tutorId`
- `/roster` — students (display name, `inAppRating`, streak, last-active, assignment progress).
- `/students/[id]` — solve history, accuracy by theme, rating trend (`RatingEvent`), badges. 404 if `student.tutorId !== tutor.id`.
- `/sets` — CRUD; MANUAL (pick puzzles) or FILTER (theme/range); publish materializes a `PuzzleSetVersion`.
- `/assign` — assign a version to a student or the whole roster; due date.
- `/goals` — set `dailyGoal` per student or class-wide.
- `/invites` — generate invite codes.

### API routes
- `/api/auth/lichess/*` — PKCE callbacks.
- `/api/puzzles/next` — opaque auto-queue fetch (single-flight).
- `/api/attempts` — create pending; submit move (optimistic cursor); finalize.
- `/api/attempts/{id}/hint`, `/api/attempts/{id}/skip` — spend endpoints.
- `/api/shop/pack/{versionId}` — bonus pack purchase.
- `/api/cron/sync-lichess` — CRON_SECRET-protected nightly rating sync.
- `/api/cron/sweep-attempts` — CRON_SECRET-protected PENDING→ABANDONED TTL sweep.

## Verification Gates (tests to write before "done")

1. **Double finalize:** two simultaneous finalizes of the same attempt grant exactly one reward and one progress update (conditional `status` update).
2. **Parallel moves:** two concurrent move submissions on one attempt — exactly one advances the cursor, the other gets `409 expected_index_mismatch`.
3. **Double `/next`:** two parallel puzzle fetches never create two rewardable attempts for the same puzzle/assignment slot.
4. **Entitlement, not attempt:** abandon a puzzle, re-open it, solve it — the solve coins credit exactly once (keyed `solve:{studentId}:{puzzleId}`).
5. **Rating goes down:** a FAILED attempt applies Elo with `actual = 0` and `inAppRating` decreases; infinite retries cannot inflate rating without bound.
6. **Retries:** a failed puzzle can be retried; it appears independently in an assignment's progress.
7. **Authorization:** cross-tutor and cross-student IDs always return 404.
8. **Streaks:** correct across local midnight and DST transitions (fixed-clock test with tz-aware dates).
9. **Queue fallback:** an exhausted rating window widens, then falls back to least-recently-seen, then "queue complete" — deterministically.
10. **Lichess resilience:** 429 responses and interrupted imports resume without duplicate puzzles or duplicate rewards.
11. **Init guard:** linking Lichess after earning an in-app rating does not overwrite `inAppRating`.
12. **Solve integrity:** a client-submitted move is validated server-side; the solution is never present in any response payload.
13. **Spending atomicity:** a hint/skip/pack purchase with insufficient balance fails with no partial state (no ledger row, no flag flip).
14. **Hint idempotency:** a second hint on the same attempt returns the already-revealed move without re-charging.
15. **Invite atomicity:** concurrent redemptions cannot enroll more students than `maxUses`.
16. **Ledger integrity:** for any student, `SUM(CoinTransaction.amount) = coinBalance` and `SUM(amount WHERE amount > 0) = lifetimeCoins` after randomized concurrent earn/spend operations.

## Open Questions / Future

- Glicko-2 precise rating (swap-in for the Elo formula; interface unchanged).
- Streak-freeze power-up, cosmetics shop (out of MVP).
- Multi-class / multi-tenant (data model is forward-compatible; add `Class` + scoping).
- Mobile app (API surface is clean enough to support one later).
