# Chess Tutor LMS — Design Spec

**Date:** 2026-07-11
**Status:** Draft v2.2 (revised after three rounds of architecture review)
**Revision note:** v2.1 left six real defects: `StudentPuzzle` was overloaded as both a permanent anti-repeat row and a transient issuance claim (conflicting semantics); the ledger relied on Prisma's throw-on-unique to "skip" duplicate credits (it actually aborts the transaction); hint/skip could charge coins on an already-finalized attempt; wrong-move duplicates weren't idempotent; "replay attenuation" was referenced but never defined; and several schema/protocol contradictions (`lifetimeCoins` invariant, `RatingEvent` had no outcome field and a dangling `attemptId`, `Unlock.remaining` non-null vs pack-insert-null, `snapshot` Json dual-sourcing versions). v2.2 adds a separate `AttemptReservation` for issuance, `ON CONFLICT DO NOTHING RETURNING` for ledger credits, `commandId` idempotency on every accepted command, an explicit "first-terminal-only" replay rule, a student-row lock serializing rating updates, and resolves all schema contradictions.

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
// references it (published content is archival, not destroyable). The version's
// contents live ONLY in the normalized `PuzzleSetVersionItem[]` rows — there is
// no denormalized JSON copy (single source of truth).
model PuzzleSetVersion {
  id        String   @id @default(cuid())
  setId     String
  set       PuzzleSet @relation(fields: [setId], references: [id], onDelete: Cascade)
  version   Int                                  // monotonic per set
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
// `revision` increments on EVERY accepted command (correct, incorrect, or
// finalize) so duplicate HTTP retries are detected: a client sends commandId,
// and AcceptedCommand(attemptId, commandId) UNIQUE makes the retry a no-op.
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
  revision      Int           @default(0)          // increments per accepted command (idempotency)
  solved        Boolean       @default(false)      // true iff status = SOLVED
  usedHint      Boolean       @default(false)
  usedSkip      Boolean       @default(false)
  failCount     Int           @default(0)          // distinct wrong commands this attempt
  isReplay      Boolean       @default(false)      // true if this puzzle was already solved by this student
  coinsAwarded  Int           @default(0)
  timeSpentMs   Int?
  createdAt     DateTime      @default(now())
  finalizedAt   DateTime?                          // set on first terminal transition
  ratingEvent   RatingEvent?
  commands      AcceptedCommand[]

  @@index([studentId, createdAt])
  @@index([puzzleId])
  @@index([assignmentId])
  @@index([status])
  @@index([studentId, status])
}

// Idempotency for EVERY accepted command (correct move, wrong move, finalize),
// not just cursor-advancing ones. A duplicate HTTP retry (network blip) hits
// the UNIQUE(attemptId, commandId) constraint and replays the prior result
// instead of, e.g., double-counting a wrong move toward FAIL_LIMIT.
model AcceptedCommand {
  id         String   @id @default(cuid())
  attemptId  String
  attempt    Attempt  @relation(fields: [attemptId], references: [id], onDelete: Cascade)
  commandId  String                           // client-generated UUID per command
  kind       String                           // "continue" | "incorrect" | "solved" | "failed"
  result     Json                             // the response body we returned the first time
  createdAt  DateTime @default(now())

  @@unique([attemptId, commandId])
  @@index([attemptId])
}

// Transient issuance reservation, SEPARATE from StudentPuzzle. Created when a
// puzzle is issued (POST /next) to claim the slot; deleted when the attempt is
// finalized (or when abandoned by the TTL sweep). StudentPuzzle (the permanent
// anti-repeat row) is written ONLY at finalize-solved, so abandonment does NOT
// poison anti-repeat freshness.
model AttemptReservation {
  id         String   @id @default(cuid())
  attemptId  String   @unique
  attempt    Attempt  @relation(fields: [attemptId], references: [id], onDelete: Cascade)
  studentId  String
  puzzleId   String
  assignmentItemId String?                     // if issued from an assignment
  createdAt  DateTime @default(now())
  expiresAt  DateTime                          // TTL; swept to ABANDONED

  @@index([studentId])
  @@index([assignmentItemId])
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
// BALANCES ARE CACHES, derived from the ledger by two DISTINCT invariants:
//   coinBalance   = SUM(amount)                          // signed: spends reduce it
//   lifetimeCoins = SUM(amount) WHERE amount > 0          // earnings only, never decreases
// Every credit AND every debit appends a ledger row in the SAME transaction
// that mutates the balance, so cache and ledger can never diverge. Idempotency
// is enforced by a UNIQUE constraint on a business key (see keys below), and
// ledger inserts use ON CONFLICT DO NOTHING RETURNING — NOT Prisma's create(),
// which throws and aborts the transaction on a unique collision.
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

// Consumables (HINT/SKIP tokens) use `remaining` (decrements); permanent
// entitlements (BONUS_PACK) set `remaining = null` (never consumed). Nullable
// so packs and tokens share one table without a sentinel int.
enum UnlockType { HINT_TOKEN SKIP_TOKEN BONUS_PACK }

model Unlock {
  id        String     @id @default(cuid())
  studentId String
  student   Student    @relation(fields: [studentId], references: [id], onDelete: Cascade)
  type      UnlockType
  refId     String?                              // bonus pack → PuzzleSetVersion id
  remaining Int?                               // null = permanent; >0 = consumable count
  createdAt DateTime   @default(now())

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
// `outcome` records what kind of attempt produced this event so dashboards can
// distinguish solve vs fail trend points. Only attempts that affect Elo create
// a RatingEvent (skip and abandon do not).
enum RatingOutcome { SOLVED FAILED }

model RatingEvent {
  id        String        @id @default(cuid())
  studentId String
  student   Student       @relation(fields: [studentId], references: [id], onDelete: Cascade)
  rating    Int                                     // snapshot of inAppRating after the attempt
  outcome   RatingOutcome                            // what caused this rating point
  delta     Int                                     // signed change applied this event
  attemptId String        @unique                   // 1:1 with the attempt that caused it
  attempt   Attempt      @relation(fields: [attemptId], references: [id], onDelete: Cascade)
  createdAt DateTime      @default(now())

  @@index([studentId, createdAt])
}
```

**Key corrections carried from v2 (still in force):**
- No `passwordHash` in app models — Better Auth owns it.
- `String[]?` → `String[] @default([])` (lists can't be optional).
- `Student` declares the `seenPuzzles StudentPuzzle[]` reverse relation.
- `Attempt` is a per-**presentation** record with an explicit state machine (`AttemptStatus`, `moveIndex`, `revision`, `finalizedAt`).
- `Attempt.assignmentId` and `AssignmentItemProgress.puzzleId` are real FKs; `AssignmentItemProgress` rows are materialized at assignment creation.
- Separate external (`lichessPuzzleRating`) vs in-app (`inAppRating`) ratings — never overwritten by sync.
- `PuzzleSetVersion` has `@@unique([setId, version])`; items `@@unique([versionId, order])` and `@@unique([versionId, puzzleId])`; published versions `onDelete: Restrict`.
- `DailyProgress` keyed by local date; `date` is `DateTime @db.Date`.

**New in v2.2 (this revision):**
- **Issuance vs anti-repeat separated:** `AttemptReservation` (transient, deleted at finalize/TTL) claims the slot; `StudentPuzzle` (permanent) is written only on SOLVED. Abandonment no longer poisons anti-repeat.
- **One PENDING attempt per student:** issuance holds `SELECT … FOR UPDATE` on the Student row. (A Postgres partial unique index `CREATE UNIQUE INDEX one_pending_attempt ON "Attempt"("studentId") WHERE status = 'PENDING'` is added in migration as a backstop.)
- **Command idempotency for all kinds:** `AcceptedCommand(attemptId, commandId)` UNIQUE + `revision` counter that increments on every accepted command (correct, wrong, finalize). Wrong moves no longer double-count on network retry.
- **Ledger uses `ON CONFLICT DO NOTHING RETURNING`:** Prisma `create` throws on unique collision and aborts the tx; the spec now mandates raw SQL with `RETURNING` so collisions are a detectable no-op, not an exception.
- **Hint/skip gated on `status = 'PENDING'` in the same tx as the charge:** `UPDATE … WHERE status='PENDING' RETURNING` — eliminates the race where a concurrent solve finalizes between balance check and flag flip.
- **Replay rule is explicit:** `Attempt.isReplay` set when the `solve:` entitlement insert returns no row; replay solves skip Elo and `RatingEvent` entirely. No undefined "attenuated K."
- **Rating updates serialized:** `SELECT … FOR UPDATE` on Student before any `inAppRating` write.
- **Schema contradictions resolved:** `lifetimeCoins` invariant stated once (signed sum vs positive-only sum); `RatingEvent` has `outcome`/`delta` and `attemptId` is a real 1:1 FK; `Unlock.remaining` nullable; `UnlockType` enum defined; `PuzzleSetVersion.snapshot` dropped (normalized items are the single source of truth).

## Server-Authoritative Solve Protocol

The client must **never** learn the solution, and must **never** decide the outcome. Three operations — **issue**, **move**, **spend** — each have explicit concurrency control. Two invariants run through all of them:

- **Every client command carries a `commandId` (UUID).** The server records `AcceptedCommand(attemptId, commandId)` with the result it returned. A duplicate retry (same commandId) replays the stored result instead of re-executing — this makes wrong moves, correct moves, hints, and skips all idempotent, not just cursor-advancing ones.
- **Rating updates are serialized by locking the student row.** Any transaction that writes `inAppRating`/`RatingEvent` first does `SELECT … FOR UPDATE` on the `Student` row. This prevents two concurrent finalizes (different attempts, same student) from both reading the same `inAppRating` and applying conflicting deltas.

### Issuing a puzzle — single-flight `/next`, reservation separate from anti-repeat
To prevent two parallel `/next` calls from creating two rewardable attempts, and to keep the permanent anti-repeat row clean:
1. **Auto-queue:** the server runs the selection query inside a transaction, `SELECT … FOR UPDATE` on the chosen `Student` row (single-flight per student), then runs the anti-repeat `NOT EXISTS` selection. It creates the PENDING `Attempt` AND an `AttemptReservation` (studentId, puzzleId, expiresAt) in the same tx. A second concurrent `/next` for the same student blocks on the student-row lock; when it proceeds, the reservation exists so it selects a *different* puzzle (or returns the in-flight attempt).
2. **Assigned set:** the server picks the lowest-`order` `AssignmentItemProgress` row with `solved = false` and no outstanding reservation for that item, locks it, creates the PENDING `Attempt` + `AttemptReservation(assignmentItemId)`.
3. The response is an **opaque presentation**:
```ts
{
  attemptId: "cuid",
  startFen: "...",            // opponent setup move already applied
  sideToMove: "white" | "black",
  themes: [...],              // display only
  expectedRevision: 0,        // the revision the server expects on the next command
}
```
**`solutionMoves` is never sent to the client.**
4. **Reservation lifecycle:** the reservation is **deleted** when the attempt finalizes (any terminal state). A TTL cron sweeps expired reservations and marks their attempts `ABANDONED`. **Crucially, `StudentPuzzle` (the permanent anti-repeat row) is written ONLY on `SOLVED` finalize** — so abandonment does not poison anti-repeat freshness, and the same puzzle can be re-served later.

### Submitting a move — commandId + cursor concurrency
Client posts `{ attemptId, commandId, move: "e2e4", expectedRevision: n }`. Server:
1. Loads the `Attempt` (must be owned by the session student).
2. **Idempotency check:** `SELECT FROM AcceptedCommand WHERE attemptId = ? AND commandId = ?`. If found, return its stored `result` (the retry is a no-op). This catches duplicate HTTP retries on **every** command kind, including wrong moves.
3. **Conditional update** — only proceeds if `status = PENDING AND revision = expectedRevision`. A concurrent command that already advanced `revision` causes a `409 revision_mismatch` (client refreshes).
4. Validates `move` against `solutionMoves[moveIndex]` via server-side `chess.js`:
   - **Illegal** → record `AcceptedCommand(commandId, "illegal", {status:"illegal"})`. `revision` does not change (no state mutated). Return stored result.
   - **Legal but wrong** → increment `failCount`, advance `revision`, record `AcceptedCommand(commandId, "incorrect", {status:"incorrect", failCount})`. If `failCount >= FAIL_LIMIT` (default 2), finalize as `FAILED` in the same tx.
   - **Correct & not terminal** → apply, auto-apply opponent reply, advance `moveIndex` by 2, advance `revision`, record `AcceptedCommand(commandId, "continue", {status:"continue", expectedRevision, opponentReply})`.
   - **Correct & terminal** → finalize as `SOLVED` (below).

### Finalize (SOLVED) — one atomic transaction, ON CONFLICT for the ledger
`UPDATE Attempt SET status='SOLVED', solved=true, finalizedAt=now(), revision=revision+1 WHERE id=? AND status='PENDING'` gates entry. Then in the **same transaction**:
1. **Ledger credit via `ON CONFLICT DO NOTHING RETURNING id`** (NOT Prisma `create`, which throws and aborts on unique collision). The entitlement key is `solve:{studentId}:{puzzleId}`:
   ```sql
   INSERT INTO "CoinTransaction" (id, "studentId", amount, reason, "idempotencyKey", "refId")
   VALUES ($id, $student, $reward, $reason, 'solve:'||$student||':'||$puzzle, $attemptId)
   ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id;
   ```
   - **If a row is RETURNED** (first-ever solve of this puzzle): increment `coinBalance` and `lifetimeCoins` by `$reward`.
   - **If no row is RETURNED** (puzzle was already solved before — replay): award **no coins**, set `Attempt.isReplay = true`. The attempt still finalizes as SOLVED (the student did solve it), but no economy effect.
2. **Write `StudentPuzzle`** (the permanent anti-repeat row) here — only on solve. `ON CONFLICT DO UPDATE SET "lastSeenAt" = now(), "timesSeen" = "StudentPuzzle"."timesSeen" + 1`.
3. **Delete the `AttemptReservation`** for this attempt.
4. Upsert `DailyProgress` (local date): `solvedCount += 1`. If `solvedCount >= dailyGoal` and not `goalBonusAwarded`, set it true and append a `+50 GOAL_BONUS` txn keyed `goal:{studentId}:{date}` (same `ON CONFLICT DO NOTHING RETURNING` pattern).
5. **Rating update, serialized:** `SELECT … FOR UPDATE` on the Student row, compute Elo delta (see Rating Formula — replay solves do NOT affect rating), `UPDATE Student SET inAppRating = inAppRating + delta`, insert `RatingEvent(rating: newRating, outcome: SOLVED, delta, attemptId)`.
6. If `assignmentId` set: conditional `UPDATE AssignmentItemProgress SET solved=true, "firstSolvedAt"=now() WHERE id=? AND solved=false` (atomic flip), recompute `Assignment.progress`.
7. Evaluate badges via idempotent upserts (keys below).

### Failure — rating must be able to go DOWN
A puzzle is recorded as `actual = 0` (a loss for Elo) **only** on the attempt's first terminal transition to `FAILED`:
- **FAILED** — `failCount` reaches `FAIL_LIMIT`. Conditional `status` update, record `AcceptedCommand(commandId, "failed", …)`, delete reservation. Then in same tx: `SELECT … FOR UPDATE` Student, apply Elo with `actual = 0` (rating drops), insert `RatingEvent(outcome: FAILED, delta, attemptId)`. No coin reward, no `StudentPuzzle` write. Increment `AssignmentItemProgress.attempts` if assigned (does not set `solved`).
- **SKIPPED** — see Spend. **No Elo change** (neutral), no reward, does not break streak. The `AssignmentItemProgress` is marked seen-but-unsolved.
- **ABANDONED** — TTL sweep. No Elo, no reward, no streak impact, reservation deleted.

**Replay rule (explicit):** only the **first terminal presentation** of a given (student, puzzle) pair affects Elo. Implementation: the rating step checks `Attempt.isReplay` (set when the `solve:` entitlement insert returned nothing). If `isReplay`, skip the Elo update and the `RatingEvent` insert entirely. This is the complete definition — there is no separate "attenuated K" formula; replays simply don't touch rating. This removes the farming vector (memorized replay-solves add zero rating) without inventing new math.

### Entitlement idempotency keys (business-level)
The reward ledger is keyed on *what was earned*, not *which attempt earned it*. All inserts use `ON CONFLICT DO NOTHING RETURNING` — a collision returns no row, and the caller skips the balance mutation:
| Event | `idempotencyKey` | Balance effect on collision |
|---|---|---|
| First solve of a puzzle | `solve:{studentId}:{puzzleId}` | No credit (replay) |
| Daily goal hit | `goal:{studentId}:{date}` | No bonus |
| 7-day streak | `streak:{studentId}:7` | No bonus |
| Hint purchase | `hint:{attemptId}` | No charge, return revealed move |
| Skip purchase | `skip:{attemptId}` | No charge, return already-SKIPPED |
| Pack purchase | `pack:{studentId}:{versionId}` | No charge, return already-owned |

`refId` carries the `attemptId`/`versionId` for traceability regardless.

### Spending — hint / skip / pack, all gated on status = PENDING
Every spend is a single transaction that **first claims the attempt as PENDING**, then charges. This prevents the race where a concurrent solve finalizes the attempt between the balance check and the flag flip:

1. **Hint (15 coins):** `POST /api/attempts/{id}/hint` with `{commandId}`. In one tx:
   - `UPDATE Attempt SET "usedHint" = true WHERE id = ? AND status = 'PENDING' RETURNING "moveIndex"` (if 0 rows → attempt already finalized → `409 attempt_finalized`, no charge).
   - If `usedHint` was already true, return the previously-revealed move without charging (idempotent).
   - Ledger: `INSERT … ON CONFLICT ("hint:{attemptId}") DO NOTHING RETURNING id`. If row returned, decrement `coinBalance` (conditional `>= 15`). If 0 rows, the hint was already purchased — return the move.
   - Record `AcceptedCommand(commandId, "hint", {move: solutionMoves[moveIndex]})`. Respond with the revealed move (cursor does not advance).
2. **Skip (30 coins):** `POST /api/attempts/{id}/skip` with `{commandId}`. In one tx:
   - `UPDATE Attempt SET status='SKIPPED', "usedSkip"=true, "finalizedAt"=now() WHERE id=? AND status='PENDING' RETURNING id` (0 rows → `409 attempt_finalized`).
   - Ledger `skip:{attemptId}` `ON CONFLICT DO NOTHING RETURNING`; if returned, decrement balance (conditional `>= 30`).
   - Delete the reservation. Record `AcceptedCommand`. No Elo, no `StudentPuzzle`, streak-neutral.
3. **Bonus pack (100 coins):** `POST /api/shop/pack/{versionId}`. `ON CONFLICT ("pack:{studentId}:{versionId}") DO NOTHING RETURNING`; if returned, decrement balance (conditional `>= 100`) and `INSERT Unlock(type=BONUS_PACK, refId=versionId, remaining=null)`. If 0 rows, already owned → return success.

### Concurrency summary (what makes each path safe)
| Race | Guard |
|---|---|
| Double `/next` → two attempts same student | `SELECT … FOR UPDATE` on Student row during issuance (single-flight per student) |
| Same assignment item issued twice | Reservation row with `assignmentItemId` uniqueness within the tx |
| Parallel commands on one attempt (any kind) | `AcceptedCommand(attemptId, commandId)` UNIQUE; `WHERE status='PENDING' AND revision=expected` |
| Duplicate HTTP retry (network blip) | `commandId` replay returns stored result, no re-execution |
| Double finalize of one attempt | `WHERE status='PENDING'` conditional update |
| Same puzzle solved via two attempts | Entitlement key `solve:{studentId}:{puzzleId}` + `ON CONFLICT DO NOTHING RETURNING` |
| Cross-attempt concurrent finalize corrupting rating | `SELECT … FOR UPDATE` on Student row before any Elo write |
| Replay-solve inflating rating | `isReplay` flag → rating step skipped entirely |
| Hint/skip charging on a finalized attempt | `... WHERE status='PENDING' RETURNING` gates the charge in the same tx |
| Double hint/skip/pack charge | Entitlement keys + `ON CONFLICT DO NOTHING RETURNING` |
| Insufficient funds on spend | `WHERE coinBalance >= cost` conditional update |
| Invite over-redemption | `UPDATE InviteCode SET uses = uses + 1 WHERE id = ? AND uses < "maxUses"` (0 rows → rejected) |
| Abandonment poisoning anti-repeat | `StudentPuzzle` written only on SOLVED, not at issuance |

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
- `ratingK` starts at 40 and steps down as terminal attempts accrue (40 → 32 → 24 at 30/100/300 rated attempts), so early volatility calms over time.
- `puzzleRating` is the puzzle's stored Lichess rating (a fixed property of the puzzle, not the student).
- **Replay solves do not affect rating.** Only the first terminal presentation of a (student, puzzle) pair produces a `RatingEvent`. A replay solve (`Attempt.isReplay = true`) skips the Elo step entirely. There is no separate "attenuated K" — replays are simply not rated. This is verified by test gate #5.
- All rating updates are serialized by `SELECT … FOR UPDATE` on the `Student` row inside the finalize transaction, so two concurrent finalizes (different attempts) cannot apply conflicting deltas to the same `inAppRating`.
- Nightly Lichess sync updates `lichessPuzzleRating`/`lichessGameRating` **only** — never touches `inAppRating`.

## Gamification Rules

### Earning (append-only ledger entries)
| Event | Coins | Idempotency key | Effect on collision |
|---|---|---|---|
| Solve (no hint) | +10 | `solve:{studentId}:{puzzleId}` | No credit; `isReplay=true`; no rating change |
| Solve with hint | +5 | `solve:{studentId}:{puzzleId}` | (same) |
| Fail | 0 | — | Elo applies `actual = 0` (first fail of the pair only) |
| Hit daily goal | +50 | `goal:{studentId}:{date}` | No bonus |
| 7-day streak milestone | +100 | `streak:{studentId}:7` | No bonus |

**The solve reward is keyed on the puzzle, not the attempt** — abandoning and re-opening the same puzzle cannot double-credit, and a replay-solve credits nothing and doesn't affect rating. Failures award no coins but feed `actual = 0` into Elo so the rating can move down (first fail of the pair only). All ledger inserts use `ON CONFLICT (idempotencyKey) DO NOTHING RETURNING id` — a returned row means "first time, apply the balance delta"; no row means "already happened, skip."

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
2. **Parallel moves:** two concurrent move submissions on one attempt — exactly one advances `revision`, the other gets `409 revision_mismatch`.
3. **Command retry idempotency:** the same `commandId` submitted twice (network retry) returns the same result and does not double-count a wrong move toward `FAIL_LIMIT`.
4. **Double `/next`:** two parallel puzzle fetches never create two PENDING attempts for the same student (student-row lock + partial unique index).
5. **Entitlement, not attempt:** abandon a puzzle, re-open it, solve it — the solve coins credit exactly once (keyed `solve:{studentId}:{puzzleId}`, `ON CONFLICT DO NOTHING RETURNING`).
6. **Replay neutrality:** solving an already-solved puzzle sets `isReplay=true`, awards no coins, and creates no `RatingEvent` (rating unchanged).
7. **Rating goes down:** a FAILED attempt applies Elo with `actual = 0` and `inAppRating` decreases (first fail of the pair).
8. **Rating serialization:** two concurrent finalizes of *different* attempts (same student) produce two `RatingEvent`s whose deltas sum correctly (no lost update).
9. **Retries:** a failed puzzle can be retried; it appears independently in an assignment's progress.
10. **Authorization:** cross-tutor and cross-student IDs always return 404.
11. **Streaks:** correct across local midnight and DST transitions (fixed-clock test with tz-aware dates).
12. **Queue fallback:** an exhausted rating window widens, then falls back to least-recently-seen, then "queue complete" — deterministically.
13. **Abandonment cleanliness:** an abandoned attempt leaves no `StudentPuzzle` row (the puzzle can be re-served and anti-repeat freshness is intact).
14. **Lichess resilience:** 429 responses and interrupted imports resume without duplicate puzzles or duplicate rewards.
15. **Init guard:** linking Lichess after earning an in-app rating does not overwrite `inAppRating`.
16. **Solve integrity:** a client-submitted move is validated server-side; the solution is never present in any response payload.
17. **Spend/finalize race:** a hint or skip request arriving concurrently with a solve finalization either charges-and-sets-flags or is rejected `409 attempt_finalized` — never charges on an already-finalized attempt.
18. **Spending atomicity:** a hint/skip/pack purchase with insufficient balance fails with no partial state (no ledger row, no flag flip).
19. **Hint idempotency:** a second hint on the same attempt returns the already-revealed move without re-charging.
20. **Invite atomicity:** concurrent redemptions cannot enroll more students than `maxUses`.
21. **Ledger integrity:** for any student, `SUM(CoinTransaction.amount) = coinBalance` and `SUM(amount WHERE amount > 0) = lifetimeCoins` after randomized concurrent earn/spend operations.

## Open Questions / Future

- Glicko-2 precise rating (swap-in for the Elo formula; interface unchanged).
- Streak-freeze power-up, cosmetics shop (out of MVP).
- Multi-class / multi-tenant (data model is forward-compatible; add `Class` + scoping).
- Mobile app (API surface is clean enough to support one later).
