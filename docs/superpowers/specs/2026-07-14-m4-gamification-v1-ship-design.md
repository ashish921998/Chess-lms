# Chess LMS — Milestone 4: Gamification & V1 Ship (Design)

> **Parent spec:** `docs/superpowers/specs/2026-07-11-chess-lms-design.md`
> **Prior milestone:** M3 — Puzzle Sets & Assignments (`docs/superpowers/specs/2026-07-13-m3-puzzle-sets-assignments-design.md`)
> **Status:** Approved in brainstorm (2026-07-14). Implementation plan TBD.

## Goal

Ship V1. Complete the gamification loop (spend → streaks → badges → leaderboard), add tutor depth (`/students/[id]`, `/goals`), wire scheduled jobs (PENDING sweep + Lichess rating sync), make daily progress timezone-correct, and bring every remaining surface onto the Paper Mono design system. After M4, the product matches the master spec's V1 scope.

## Scope decisions (from brainstorm)

| Decision | Choice |
|---|---|
| M4 scope | **Everything remaining** — gamification + tutor depth + crons + Paper Mono redesign. One design, three implementation slices. |
| Daily-progress timezone | **Student-set IANA tz** (per master spec). Students pick their timezone on `/profile`; streaks and daily goals respect it. The `Student.timezone` field already exists (default `"UTC"`). |
| Scheduled jobs | **Vercel Cron** (per master spec). `vercel.json` with two entries; routes are `CRON_SECRET`-protected and idempotent. |
| Badge set | **All 7** from the spec, including `theme_master_<theme>` (one badge per theme at 20 solves). |
| Hint semantics | **Spec model**: reveal the full correct move (UCI) for 15 coins; reward drops 10→5; still rated as SOLVED_HINTED. One hint per attempt. (Deliberately more generous than Lichess, which highlights only the piece and makes the puzzle unrated — the coin economy is a feature, not a rating toggle.) |
| Spend confirmation | **Always-visible buttons + confirm popover.** Hint/Skip buttons show during any PENDING attempt; clicking opens a confirm showing the cost + live balance. Insufficient funds → disabled with tooltip. Protects irreversible coin spends. |
| Leaderboard richness | **Bare ranking (spec).** Class ranked by `lifetimeCoins DESC`, tie-broken by `(solvedCount DESC, id ASC)`. Display names only. Own row highlighted. Nothing more. |
| `/students/[id]` content | **All four**: overview stats + rating trend, solve history + theme accuracy, assignment progress, badges. |
| Daily-goals UI | **Roster table + set-all.** `/goals` page: one row per student with inline-editable `dailyGoal`, plus a "set all to N" control. |
| Tutor nav | **4 items**: Roster · Sets · Assign · Goals. Invites stay as a panel on Roster. `/students/[id]` reached by clicking a roster row. |
| Student nav | **4 items**: Dashboard · Practice · Leaderboard · Profile. Timezone + badges on Profile. |
| Profile layout | **Layout B — split identity + dark stats.** Lichess + timezone share a left `--panel`; stats in one dark `--ink` panel right (the one-dark-card-per-group move from DESIGN.md); badges full-width below. |
| Implementation slicing | **Engine → Student UI → Tutor UI.** Matches M3's backend-first cadence; hard concurrency logic is TDD'd before any UI. |

## Out of scope (deferred / future)

- Glicko-2 precise rating (master spec "Open Questions").
- FILTER-mode "frozen-at-publish" / "freeze-on-first-visit" variants (M3 deferred).
- Bonus pack shop / power-up inventory / streak-freeze / cosmetics (master spec out-of-scope).
- Multi-class / multi-tenant (data model is forward-compatible).
- Mobile app.
- Weekly rank-delta indicators on the leaderboard (would need a rank-snapshot table).
- Two-tier hints (cheap piece-highlight + full reveal) — considered and cut; the single full-reveal hint is the spec model.

## Background: what already exists

The gamification data model is **already in the Prisma schema** from M1. M4 adds no new tables and no new enums:

- `Student.timezone` (default `"UTC"`), `dailyGoal` (default 5), `coinBalance`, `lifetimeCoins`, `inAppRating`, `ratingK` — all present.
- `CoinTransaction` with reasons `SOLVE`, `SOLVE_HINTED`, `GOAL_BONUS`, `STREAK_BONUS`, `PURCHASE_HINT`, `PURCHASE_SKIP` — all in the enum.
- `DailyProgress` (`studentId`, `date @db.Date`, `solvedCount`, `goalMet`, `goalBonusAwarded`) — present.
- `StudentBadge` (`studentId`, `badgeKey`, `awardedAt`, `@@unique([studentId, badgeKey])`) — present.
- `Attempt.usedHint`, `hintMove`, `usedSkip` — present.
- `RatingEvent` — present (M1 writes it from `finalizeSolvedTx`/`finalizeFailedTx`).

**What's implemented:** `finalizeSolvedTx` already does ledger credit (ON CONFLICT), `StudentPuzzle` write, `DailyProgress` upsert + goal bonus, Elo, and assignment progress (MANUAL + FILTER). The coin ledger, daily goals, and rating are live.

**What's missing (M4 fills):**
1. **Timezone-correct daily progress** — `finalize.ts:91` hardcodes UTC (`const today = new Date()`). Has a TODO: "M4 will use the student's IANA tz."
2. **Spend routes** — no `/api/attempts/[id]/hint` or `/skip` routes. `Attempt` fields exist but are never written.
3. **Streaks** — `finalizeSolvedTx` step 6 (streak check) is a no-op; no streak calculation, no 7/30-day bonuses.
4. **Badges** — `StudentBadge` table exists; no evaluation logic, no `badges.ts`.
5. **Leaderboard** — no page, no query.
6. **Crons** — no sweep/sync routes, no `vercel.json`.
7. **Tutor depth** — no `/students/[id]`, no `/goals`.
8. **Paper Mono** — `profile/page.tsx`, `roster/page.tsx`, `invite-codes.tsx`, and `puzzle-board.tsx` still use old `rounded-lg`/`bg-white`/`text-slate` styling.

## Data model changes

**No new tables. No new enums.** One small migration for defensive check constraints the master spec calls for as backstops:

```sql
-- migration: add balance non-negativity backstops
ALTER TABLE "Student" ADD CONSTRAINT coin_balance_nonneg CHECK ("coinBalance" >= 0);
ALTER TABLE "Student" ADD CONSTRAINT lifetime_coins_nonneg CHECK ("lifetimeCoins" >= 0);
```

The app already prevents negative balances via conditional `UPDATE … WHERE coinBalance >= cost RETURNING` (spend routes, §2b). These DB-level checks are a defense-in-depth backstop against a future bug. Existing rows (all ≥0) satisfy the constraint.

**New dependency:** `date-fns-tz` — for IANA-timezone-aware date computation (handles DST). Small, well-maintained.

## Slice 1 — Gamification Engine (backend + tests)

All logic extracted into `src/lib/gamification/` modules, each taking an injected `PrismaTransaction` so tests drive them inside a rollback tx (mirroring the `finalize.ts` / `sets.ts` pattern).

### 1a. Timezone-correct daily progress (gap-fill)

New module `src/lib/gamification/dates.ts`:

```ts
import { formatInTimeZone } from "date-fns-tz";

/**
 * The student's local calendar date (date-only) for a given instant, as a
 * Date usable as a DailyProgress key. DailyProgress.date is @db.Date
 * (tz-naive date-only), so we store the student's LOCAL calendar date —
 * not the UTC date. This makes streak boundaries correct across timezones
 * and DST: a solve at 11pm EST on Jan 5 counts toward Jan 5, not Jan 6.
 */
export function localDateFor(at: Date, tz: string): Date {
  const ymd = formatInTimeZone(at, tz, "yyyy-MM-dd");
  return new Date(ymd + "T00:00:00Z");
}
```

**`finalizeSolvedTx` change:** replace the UTC `today`/`dateOnly` computation (lines ~91-92) with `const dateOnly = localDateFor(new Date(), attempt.timezone)`. The goal-bonus idempotency key (`goal:{studentId}:{dateOnly.toISOString().slice(0,10)}`) stays correct because `dateOnly` is now the local date.

`FinalizeAttempt` gains a `timezone: string` field. The move route already loads the student (for ownership); it passes `student.timezone` through `toFinalizeAttempt`.

### 1b. Spend economy — hint & skip

New module `src/lib/gamification/spend.ts` with two transactional functions, plus two thin routes.

**Hint (15 coins) — `POST /api/attempts/[id]/hint`**

Route: ownership check (`attempt.studentId === student.id`), then delegates to `purchaseHintTx(tx, attempt)`:

1. If `status != 'PENDING'` → `409 attempt_not_pending` (finalized/abandoned — no charge).
2. If `usedHint` already true → return stored `hintMove` (idempotent, no charge).
3. Conditional balance debit: `UPDATE Student SET coinBalance = coinBalance - 15 WHERE id = ? AND coinBalance >= 15 RETURNING id`. Zero rows → `402 insufficient_funds`, transaction rolls back, **no state mutated** (no ledger row, no flag flip).
4. Insert `CoinTransaction(-15, PURCHASE_HINT, "hint:{attemptId}")` via `ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id`. If no row returned (retry after a partial success), don't re-charge — but still ensure `usedHint`/`hintMove` are set (step 5 is idempotent).
5. Set `Attempt.usedHint = true`, `Attempt.hintMove = solutionMoves[moveIndex]`. Return `{ hintMove }`.
6. **Cursor does not advance** — the student still must play the revealed move.

Response: `{ status: "hinted", hintMove: "e2e4" }`.

**Skip (30 coins) — `POST /api/attempts/[id]/skip`**

Route: ownership check, then `purchaseSkipTx(tx, attempt)`:

1. If `status = 'SKIPPED'` → return idempotent `{ status: "skipped" }` (no charge). Any other non-PENDING → `409 attempt_not_pending`.
2. Conditional balance debit (same pattern, cost 30). Zero rows → `402`, rollback.
3. Insert `CoinTransaction(-30, PURCHASE_SKIP, "skip:{attemptId}")` via `ON CONFLICT DO NOTHING RETURNING`.
4. Finalize: `UPDATE Attempt SET status='SKIPPED', usedSkip=true, finalizedAt=now() WHERE id=? AND status='PENDING'`. No Elo, no `StudentPuzzle`, streak-neutral.

Response: `{ status: "skipped" }`.

Both routes live under `src/app/api/attempts/[id]/` next to `move/route.ts`. The `FinalizeAttempt`-shaped input (with `solutionMoves` for hint) is loaded by the route and passed in.

### 1c. Streaks — calculation + bonuses

New module `src/lib/gamification/streaks.ts`.

**Current streak** = count of consecutive `DailyProgress` rows (for this student) with `goalMet = true`, ending at the student's local today. If today is not yet met, the chain counts back from yesterday (so an unbroken streak isn't displayed as broken just because the student hasn't solved yet today — it breaks only when a day is *missed*).

```ts
/**
 * Count consecutive goal-met days ending today (or yesterday if today
 * isn't met yet). `todayLocal` is the student's local date from localDateFor().
 */
export async function currentStreak(
  tx: PrismaTransaction,
  studentId: string,
  todayLocal: Date
): Promise<number>
```

Implementation: query `DailyProgress` for the student ordered by `date DESC` from today back; walk backward while `goalMet = true`. If today's row doesn't exist or isn't met, start from yesterday. Returns the run length. (A recursive CTE is an alternative; the iterative TS approach is clearer and the row count is small — at most ~30 rows for a 30-day streak.)

**Bonuses** — filled into `finalizeSolvedTx` step 6 (currently a no-op). After the `DailyProgress` upsert (step 4), compute `currentStreak`. If streak ≥ 7 and no `CoinTransaction` with key `streak:{studentId}:7` exists, append `+100 STREAK_BONUS` via `ON CONFLICT DO NOTHING RETURNING`; if a row is returned, increment `coinBalance`/`lifetimeCoins`. Repeat the same pattern for 30 (`+250`, key `streak:{studentId}:30`). Idempotent — awarding twice is a no-op.

### 1d. Badges — evaluation at finalize

New module `src/lib/gamification/badges.ts`, called at the end of `finalizeSolvedTx` (SOLVED path only). All badges use idempotent upserts: `INSERT INTO "StudentBadge" … ON CONFLICT ([studentId, badgeKey]) DO NOTHING`.

| Badge | `badgeKey` | Condition (evaluated at SOLVED finalize) |
|---|---|---|
| First solve | `first_solve` | count of prior SOLVED attempts for this student = 0 |
| 7-day streak | `streak_7` | `currentStreak` ≥ 7 |
| 30-day streak | `streak_30` | `currentStreak` ≥ 30 |
| Centurion | `centurion` | lifetime solved count (SOLVED attempts) ≥ 100 |
| Sharpshooter | `sharpshooter` | last 10 terminal attempts (SOLVED or FAILED) are all SOLVED — i.e. no FAILED in the trailing 10 |
| Theme master | `theme_master_<theme>` | for each theme in this puzzle's `themes[]`: the student's count of SOLVED attempts on puzzles whose `themes` contains `<theme>` ≥ 20 |
| Comeback | `comeback` | the 3 attempts immediately before this one (by `createdAt`) are all FAILED |

**Evaluation strategy:**
- `first_solve`, `centurion`: one `COUNT` query each.
- `streak_7`, `streak_30`: reuse `currentStreak` (already computed in step 6).
- `sharpshooter`: one query — `SELECT status FROM "Attempt" WHERE studentId = ? AND status IN ('SOLVED','FAILED') ORDER BY "createdAt" DESC LIMIT 10`; badge fires iff all 10 are SOLVED (and there are 10). Does not fire before 10 terminal attempts exist.
- `comeback`: one query — the 3 attempts immediately preceding this one by `createdAt`; badge fires iff all 3 are FAILED. (This is the "solved immediately following 3 consecutive failed attempts" condition.)
- `theme_master_<theme>`: for each theme `t` in `puzzle.themes[]`, run `SELECT COUNT(*) FROM "Attempt" a JOIN "Puzzle" p ON p.id = a."puzzleId" WHERE a."studentId" = ? AND a.status = 'SOLVED' AND $t = ANY(p.themes)`. If ≥ 20, upsert `theme_master_${t}`. A puzzle with 3 themes runs 3 count queries. Only the *current puzzle's* themes are evaluated — the badge naturally fires when a solve pushes a theme to 20.

All queries are bounded and run in the same transaction. `badges.ts` exports `evaluateBadgesTx(tx, attempt, streak)` where `streak` is passed in (already computed) to avoid re-querying.

**On FAILED finalize:** no badge evaluation. Badges celebrate positive milestones. `comeback` evaluates on the *next* SOLVED after the failures, which is when `finalizeSolvedTx` runs.

### 1e. Leaderboard query

New module `src/lib/gamification/leaderboard.ts`:

```sql
SELECT
  s.id, s."displayName", s."lifetimeCoins",
  COUNT(a.id) FILTER (WHERE a.status = 'SOLVED') AS "solvedCount"
FROM "Student" s
LEFT JOIN "Attempt" a ON a."studentId" = s.id
WHERE s."tutorId" = $tutorId
GROUP BY s.id
ORDER BY s."lifetimeCoins" DESC, "solvedCount" DESC, s.id ASC;
```

Ranked by `lifetimeCoins DESC`, tie-broken by `(solvedCount DESC, id ASC)` — exactly the master spec. Display names only; no emails. The caller (the `/leaderboard` page) flags the session student's own row client-side.

### 1f. Cron routes

Two stateless routes, both verify `req.headers.get("authorization") === "Bearer " + process.env.CRON_SECRET` and return 401 otherwise. Both idempotent.

**`/api/cron/sweep-attempts` (hourly):**
```sql
UPDATE "Attempt" SET status = 'ABANDONED', "finalizedAt" = NOW()
WHERE status = 'PENDING' AND "createdAt" < NOW() - INTERVAL '2 hours';
```
Returns `{ swept: rowCount }`. Abandoned attempts award nothing, write no `StudentPuzzle` (puzzles can be re-served). The 2-hour TTL matches the master spec.

**`/api/cron/sync-lichess` (daily):**
For each `LichessConnection`, `GET https://lichess.org/api/user/{username}` (public, no token) → read `perfs.puzzle.rating` and `perfs.rapid.rating` (fallback `blitz`), update `Student.lichessPuzzleRating`/`lichessGameRating`, set `LichessConnection.lastSyncedAt`. Handle 429 with backoff (skip the student, retry next run); on any failure, leave previous values intact. Never touches `inAppRating` (the init guard holds — linking after practice doesn't overwrite). Sequential with a small delay between requests to be polite to the Lichess API.

**`vercel.json`:**
```json
{
  "crons": [
    { "path": "/api/cron/sweep-attempts", "schedule": "0 * * * *" },
    { "path": "/api/cron/sync-lichess", "schedule": "0 3 * * *" }
  ]
}
```

## Slice 2 — Student UI

### 2a. Leaderboard page (`/leaderboard`)

New page, new nav item. A single ranked table. Per DESIGN.md data-table convention: mono, uppercase header row in `--muted`, 1px `--line` row separators, right-aligned numerics, rust on `lifetimeCoins` (the one number that matters). Columns: rank (mono numeral), display name, lifetime coins (right-aligned, rust), solved count (right-aligned). The session student's own row gets a subtle `--panel` background + a rust "YOU" tag so they find themselves fast. No avatars, no medals, no icons — quiet. Empty state: "No rankings yet — solve some puzzles to appear here."

### 2b. Profile redesign (`/profile`) — Layout B

Split identity + dark stats (approved in brainstorm). Structure:

- **Left column (`--panel`):** "Lichess" section — connection status (✓ connected as `{username}` / "Connect Lichess" button), puzzle rating, game rating, last synced. Below it, "Timezone" — a `<select>` of common IANA zones (a curated list: the major US zones, Europe/London, Europe/Paris, Asia/Kolkata, Asia/Shanghai, Asia/Tokyo, UTC, plus an optgroup of others). Submitting the timezone POSTs to `/api/student/timezone` (new route, guarded by `requireStudent()`, validates the tz string against `Intl.supportedValuesOf('timeZone')`).
- **Right column (`--ink` dark panel):** "Stats" — rating, coins (rust), streak, daily goal. One dark card per group (DESIGN.md). Serif numerals on `--paper` text.
- **Full-width below (`--panel`):** "Badges" — earned badges as hairline-bordered tags (earned = `--rust` border + rust text for the most recent / milestone; others `--line` border). Each tag shows the badge label in uppercase mono. A count header: "BADGES · 4 EARNED". Empty state: "No badges yet — keep solving."

The existing Lichess connect/disconnect logic and stats query stay; only markup/styling changes. The timezone select + its route are new.

**`/api/student/timezone` route:** `PATCH`-style, body `{ timezone: string }`. Guarded by `requireStudent()`. Validates `timezone` is a real IANA zone (`Intl.supportedValuesOf('timeZone').includes(tz)`). Updates `Student.timezone`. Returns 400 on invalid tz.

### 2c. Puzzle-board — spend buttons + Paper Mono

`PuzzleBoard` component (`src/components/chess/puzzle-board.tsx`):

**Paper Mono restyle:** board colors → play-board palette (light `#ece4d2`, dark `#a8926b`, per DESIGN.md). Status messages use semantic colors (`--success` olive, `--error` brick, `--muted`) not `text-green-700`/`text-red-700`. The "back to puzzles" / "next puzzle" links use rust underline. Square corners on the board frame (`border-radius: 0`).

**Spend buttons:** Two buttons below the board during any PENDING attempt:
- `HINT · 15` — visible whenever the attempt is PENDING and `usedHint` is false. Disabled (muted, with tooltip "Need 15 coins") if `coinBalance < 15`.
- `SKIP · 30` — same conditions, cost 30.

Clicking either opens a **confirm popover** (a small absolutely-positioned `--panel` with `--ink` border): "Reveal the best move for 15 coins? Balance: {n}" / "Skip this puzzle for 30 coins? Balance: {n}" with Confirm / Cancel. On confirm, POST to `/api/attempts/[id]/hint` or `/skip`.

- **Hint success:** highlight the revealed move on the board (a rust move-dot or arrow on the source-destination squares) but do **not** auto-play it — the student still drags it. Set `usedHint = true` locally; hide the hint button.
- **Hint idempotent return** (already `usedHint`): the route returns the stored `hintMove`; re-highlight it.
- **Skip success:** board shows "Skipped" status; show "Next puzzle →" link. Hide both spend buttons.
- **Insufficient funds (402):** the popover shows "Not enough coins" and the button disables.
- **Attempt not pending (409):** reload state (the attempt was finalized elsewhere).

The board needs to know the current `coinBalance` to render the disabled state and the confirm popover. This is passed from the server component (which loads the student) as a prop, and refreshed after a spend via `router.refresh()` or a local state update from the response.

### 2d. Dashboard enrichment (`/dashboard`)

Additive only — the existing Paper Mono dashboard gains:
- **Streak** in the top stat row (4th `StatCard`: current streak count). The dashboard query already loads the student; streak is computed from `DailyProgress` (a small query).
- **Daily goal progress** — a line under the header eyebrow: `3/5 TODAY` (solvedCount today / dailyGoal), with the count in rust when the goal is met.

The "Start daily practice" CTA, assignments section, puzzles list, and recent activity are unchanged.

## Slice 3 — Tutor UI & Ops

### 3a. Tutor nav (4 items)

`Roster · Sets · Assign · Goals`. Invites stay as a panel on Roster. `/students/[id]` reached from roster rows. The existing `/tutor/sets` path is unchanged.

### 3b. Roster restyle + student links

Roster page content moves to Paper Mono (layout chrome is already there). Each student row → a framed `--panel` card with hairline structure: display name (now a link to `/students/[id]`), `inAppRating` (rust), active-assignment count, last-active. Assignment chips switch from `bg-green-50`/`bg-slate-100` to hairline-bordered tags (completed = olive `--success` text + check; active = `--muted`). The invite-codes panel restyles to Paper Mono (square corners, mono code with `formatCode`, hairline rows, rust Copy/Revoke links) — logic unchanged.

### 3c. `/students/[id]` — per-student detail

The tutor's deep-teaching view. Reached from the roster; `notFound()` if `student.tutorId !== tutor.id` (no existence leak). Paper Mono throughout. Sections:

- **Header:** display name (serif), `inAppRating`, streak, "X solved", coins — a compact stat strip with an eyebrow.
- **Rating trend:** a minimal inline SVG line chart of `RatingEvent.rating` over time. No charting library — a server-rendered SVG `<path>` from the rating events, with mono axis labels and a rust line. Width responsive; height ~120px. Empty state if <2 events.
- **Theme accuracy:** a table — one row per theme the student has attempted, columns: THEME, SOLVED/ATTEMPTED, ACCURACY %. Sorted by attempted desc. Hairline rows, right-aligned numerics, rust on accuracy. Computed by joining `Attempt` → `Puzzle.themes` and grouping.
- **Solve history:** last ~20 terminal attempts (puzzle id, outcome SOLVED/FAILED, date). Same table treatment as dashboard recent activity. Rust check / brick X for outcome.
- **Assignment progress:** per-assignment row — set title, `progress/total`, completed tag, replays count. Same shape as the student dashboard assignment cards but in a table. Sorted by `createdAt DESC`.

### 3d. `/goals` — daily-goal management

Roster table + set-all (approved). One screen:

- **Top:** a "Set all to [N]" control — a number input + "Apply to roster" button. POSTs `{ all: true, dailyGoal: N }` to `/api/tutor/goals`.
- **Table:** one row per student (display name, current `dailyGoal` as an inline-editable number input). Editing + blur/enter POSTs `{ studentId, dailyGoal }` to `/api/tutor/goals`. Validated server-side (`dailyGoal >= 1`).
- Paper Mono table styling. Inline edit feedback: a subtle "saved" flash or error text.

**`/api/tutor/goals` route:** `PATCH`-style. Guarded by `getTutorActor()`, scoped by `tutorId` (a `studentId` not in the tutor's roster → 404). Body either `{ studentId, dailyGoal }` (single) or `{ all: true, dailyGoal }` (class-wide). Validates `Number.isInteger(dailyGoal) && dailyGoal >= 1`. Updates `Student.dailyGoal`. Returns 400 on invalid.

### 3e. Crons + vercel.json

Covered in §1f. `vercel.json` lands here (deploy infra). Both cron routes were built in slice 1 (engine); this slice just adds the config file.

## Concurrency & integrity

Extends the parent spec's table. All new patterns reuse the proven `finalize.ts` shape.

| Race / invariant | Guard |
|---|---|
| Spend on finalized attempt | `WHERE status = 'PENDING'` gate in same tx as charge |
| Spend with insufficient funds | `UPDATE … WHERE coinBalance >= cost RETURNING`; 0 rows → `402`, rollback, no partial state |
| Double hint charge | `usedHint` already true → return stored `hintMove`, no charge |
| Double skip charge | `status = 'SKIPPED'` → idempotent return, no charge |
| Streak bonus double-credit | `ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING` on `streak:{studentId}:7` / `:30` |
| Badge double-award | `ON CONFLICT ([studentId, badgeKey]) DO NOTHING` upsert |
| Cross-tutor `/students/[id]` access | `student.tutorId !== tutor.id` → `notFound()` (404, no existence leak) |
| Cross-tutor `/goals` mutation | student not in tutor's roster → 404 |
| Cron unauthorized call | `authorization: Bearer CRON_SECRET` header check → 401 |
| Cron sweep re-abandoning | `WHERE status = 'PENDING'` — already-terminal attempts skipped |
| Negative coin balance (future bug) | DB CHECK constraint `coinBalance >= 0` (backstop) + app-level conditional update |
| Daily-progress tz drift | `localDateFor` uses student's IANA tz; `DailyProgress.date` stores local calendar date |

## Verification gates (tests to write before "done")

Extends the parent spec's gate list and M3's. Unit-testable items use Vitest; full-flow items use the seeded DB harness (`tests/db-harness.ts`).

### Engine (slice 1)

1. **Timezone correctness:** a solve at 11pm EST (UTC-5) on Jan 5 counts toward `DailyProgress` Jan 5, not Jan 6 (fixed-clock test with a tz-aware student).
2. **Hint charges & reveals:** hint on a PENDING attempt debits 15, sets `usedHint`/`hintMove`, returns the correct move, does not advance `moveIndex`.
3. **Hint idempotency:** second hint on same attempt returns stored `hintMove` without re-charging.
4. **Hint on finalized attempt:** returns `409`, no charge, no ledger row.
5. **Hint insufficient funds:** `coinBalance < 15` → `402`, no ledger row, no `usedHint` flip.
6. **Skip charges & finalizes:** skip on PENDING debits 30, sets `status='SKIPPED'`, no Elo, no `StudentPuzzle`, streak-neutral.
7. **Skip idempotency:** second skip on a SKIPPED attempt returns idempotent `{ status: "skipped" }`, no charge.
8. **Skip insufficient funds:** `coinBalance < 30` → `402`, no state mutated.
9. **Streak calc — unbroken:** 7 consecutive goal-met days → `currentStreak` returns 7.
10. **Streak calc — today not yet met:** streak counts back from yesterday; today's unsolved day doesn't break it.
11. **Streak calc — broken:** a missed day (goalMet=false) in the chain → streak ends at the gap.
12. **7-day streak bonus:** crossing streak 7 credits exactly one `+100 STREAK_BONUS` (key `streak:{studentId}:7`); repeat finalize does not double-credit.
13. **30-day streak bonus:** crossing streak 30 credits exactly one `+250` (key `streak:{studentId}:30`).
14. **Badge `first_solve`:** awarded on the student's first SOLVED attempt; not re-awarded on the second.
15. **Badge `streak_7` / `streak_30`:** awarded when streak crosses the threshold.
16. **Badge `centurion`:** awarded when lifetime solved count reaches 100.
17. **Badge `sharpshooter`:** awarded when the last 10 terminal attempts are all SOLVED; does not fire before 10 terminal attempts exist; does not fire if any of the last 10 is FAILED.
18. **Badge `theme_master_<theme>`:** awarded when a theme's solved count reaches 20; only the current puzzle's themes are evaluated.
19. **Badge `comeback`:** awarded when a SOLVED attempt immediately follows 3 consecutive FAILED attempts.
20. **Badge idempotency:** re-evaluating badges on a re-finalize does not duplicate `StudentBadge` rows.
21. **Leaderboard ranking:** students ordered by `lifetimeCoins DESC`, then `solvedCount DESC`, then `id ASC`; display names only (no emails).
22. **Cron sweep:** PENDING attempts older than 2h → ABANDONED; newer PENDING untouched; already-terminal untouched.
23. **Cron sync:** updates `lichessPuzzleRating`/`lichessGameRating` + `lastSyncedAt`; 429 → skip (values intact); never touches `inAppRating`.
24. **Cron auth:** missing/wrong `CRON_SECRET` → 401.
25. **Ledger integrity after spend:** `SUM(amount) = coinBalance` and `SUM(amount WHERE amount > 0) = lifetimeCoins` after a hint+skip sequence.

### Student UI (slice 2)

26. **Leaderboard own-row highlight:** the session student's row is flagged and findable.
27. **Timezone update:** `/api/student/timezone` with a valid IANA zone updates `Student.timezone`; invalid zone → 400.
28. **Profile badges render:** earned badges appear as tags; unearned don't.
29. **Hint button disabled state:** `coinBalance < 15` → hint button disabled with tooltip.
30. **Hint flow end-to-end:** confirm → POST → revealed move highlighted on board (not auto-played) → `usedHint` set → button hidden.
31. **Skip flow end-to-end:** confirm → POST → "Skipped" status → next-puzzle link shown.
32. **Dashboard streak + goal:** streak stat and `3/5 TODAY` progress render correctly.

### Tutor UI + ops (slice 3)

33. **`/students/[id]` auth:** cross-tutor student ID → 404.
34. **`/students/[id]` content:** rating trend, theme accuracy, solve history, assignment progress all render with the student's data.
35. **Theme accuracy correctness:** accuracy % per theme matches the solve/attempt counts.
36. **`/goals` single update:** inline edit POSTs and updates one student's `dailyGoal`.
37. **`/goals` set-all:** "set all to N" updates every student in the roster.
38. **`/goals` validation:** `dailyGoal < 1` or non-integer → 400, no update.
39. **`/goals` cross-tutor:** a `studentId` not in the tutor's roster → 404.
40. **Roster student links:** display names link to `/students/[id]`.
41. **`vercel.json` valid:** both cron paths and schedules present and syntactically valid.

## Open questions / future

- **Reassignment policy** (from M3): today re-assign is skip-if-exists. A "replace with new version" flow is a natural follow-up.
- **FILTER mode variants:** frozen-at-publish / freeze-on-first-visit (M3 deferred).
- **Weekly leaderboard movement** (rank delta): would need a rank-snapshot table — considered and cut from M4.
- **Two-tier hints:** cheap piece-highlight + full reveal — considered and cut.
- **Badge notification/toast:** M4 awards badges silently (they appear on `/profile`). A celebratory toast on award is a future delight feature.
- **`/students/[id]` deeper drill-down:** per-assignment attempt history, move-by-move review — future.
