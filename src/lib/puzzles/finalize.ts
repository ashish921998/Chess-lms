import { eloDelta, kFactorFor } from "@/lib/rating";
import { localDateFor } from "@/lib/gamification/dates";
import { currentStreak, awardStreakBonusesTx } from "@/lib/gamification/streaks";
import { evaluateBadgesTx } from "@/lib/gamification/badges";
import type { PrismaTransaction } from "./transaction-client";

const SOLVE_REWARD_NO_HINT = 10;
const SOLVE_REWARD_HINTED = 5;
export const FAIL_LIMIT = 2;
const GOAL_BONUS = 50;

/**
 * The fields of an `Attempt` (+ its puzzle) that finalization needs. Matches
 * the shape loaded by the move route so the route can pass it straight through.
 * `assignmentId`/`assignmentItemId` drive the assignment-progress fork.
 */
export type FinalizeAttempt = {
  id: string;
  puzzleId: string;
  studentId: string;
  usedHint: boolean;
  isReplay: boolean;
  assignmentId: string | null;
  assignmentItemId: string | null;
  /** Student's IANA tz — daily boundaries use their local calendar date. */
  timezone: string;
  /** Attempt creation time — used for the "comeback" badge's preceding-attempt query. */
  createdAt: Date;
  puzzle: { rating: number; startFen: string; solutionMoves: string[]; themes: string[] };
};

/**
 * Finalize a SOLVED attempt in one atomic transaction. Extracted (and the route
 * wraps it in `db.$transaction`) so tests can drive it inside a rollback tx.
 *
 * Steps:
 *  1. Conditional status flip (PENDING → SOLVED) — concurrent finalizes no-op.
 *  2. Ledger credit via ON CONFLICT DO NOTHING RETURNING (first solve credits;
 *     replays get nothing).
 *  3. Write StudentPuzzle (anti-repeat) — only on solve.
 *  4. Upsert DailyProgress, award goal bonus if threshold met.
 *  5. Elo update (serialized via Student-row FOR UPDATE) — replays skip.
 *  6. Assignment progress — THREE-WAY FORK (spec §Gap-fills #2):
 *     - assignmentItemId != null → MANUAL: item flip + atomic progress increment
 *       + COMPLETION GAP-FILL (conditional flip against version item count).
 *     - assignmentId != null && assignmentItemId == null && targetCount != null
 *       → FILTER: LEAST(progress+1, targetCount) + conditional completion flip.
 *     - assignmentId == null → auto-queue: skip (unchanged).
 */
export async function finalizeSolvedTx(
  tx: PrismaTransaction,
  attempt: FinalizeAttempt
): Promise<number> {
  const reward = attempt.usedHint ? SOLVE_REWARD_HINTED : SOLVE_REWARD_NO_HINT;
  const idempotencyKey = `solve:${attempt.studentId}:${attempt.puzzleId}`;

  // 1. Conditional status flip.
  const flipped = await tx.$executeRaw`
    UPDATE "Attempt" SET status = 'SOLVED', solved = true, "finalizedAt" = NOW(), revision = revision + 1
    WHERE id = ${attempt.id} AND status = 'PENDING'
  `;
  if (flipped === 0) {
    // Race lost — another request already finalized this attempt.
    // Return the coinsAwarded already on the row.
    const existing = await tx.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
    return existing.coinsAwarded;
  }

  // 2. Ledger credit via ON CONFLICT DO NOTHING RETURNING.
  const creditRow = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "CoinTransaction" (id, "studentId", amount, reason, "idempotencyKey", "refId", "createdAt")
    VALUES (gen_random_uuid(), ${attempt.studentId}, ${reward}, ${attempt.usedHint ? "SOLVE_HINTED" : "SOLVE"}, ${idempotencyKey}, ${attempt.id}, NOW())
    ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id
  `;

  const isReplaySolve = creditRow.length === 0; // no row returned = already solved before

  if (!isReplaySolve) {
    // First-ever solve of this puzzle — credit coins.
    await tx.student.update({
      where: { id: attempt.studentId },
      data: { coinBalance: { increment: reward }, lifetimeCoins: { increment: reward } },
    });
    await tx.attempt.update({ where: { id: attempt.id }, data: { coinsAwarded: reward } });
  } else {
    // Replay — no coins, mark the attempt.
    await tx.attempt.update({ where: { id: attempt.id }, data: { coinsAwarded: 0, isReplay: true } });
  }

  // 3. Write StudentPuzzle (permanent anti-repeat) — only on solve.
  await tx.$executeRaw`
    INSERT INTO "StudentPuzzle" ("studentId", "puzzleId", "firstSeenAt", "lastSeenAt", "timesSeen")
    VALUES (${attempt.studentId}, ${attempt.puzzleId}, NOW(), NOW(), 1)
    ON CONFLICT ("studentId", "puzzleId") DO UPDATE SET "lastSeenAt" = NOW(), "timesSeen" = "StudentPuzzle"."timesSeen" + 1
  `;

  // 4. DailyProgress — the student's local calendar date, so streak/daily-goal
  //    boundaries respect their timezone (a 11pm EST solve counts toward EST's
  //    date, not the next UTC day).
  const dateOnly = localDateFor(new Date(), attempt.timezone);
  const dp = await tx.dailyProgress.upsert({
    where: { studentId_date: { studentId: attempt.studentId, date: dateOnly } },
    update: { solvedCount: { increment: 1 } },
    create: { studentId: attempt.studentId, date: dateOnly, solvedCount: 1 },
  });

  // Goal bonus: if this solve met the daily goal and we haven't already bonused.
  const studentRow = await tx.student.findUniqueOrThrow({ where: { id: attempt.studentId } });
  if (dp.solvedCount >= studentRow.dailyGoal && !dp.goalBonusAwarded) {
    const goalKey = `goal:${attempt.studentId}:${dateOnly.toISOString().slice(0, 10)}`;
    const goalCredit = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "CoinTransaction" (id, "studentId", amount, reason, "idempotencyKey", "createdAt")
      VALUES (gen_random_uuid(), ${attempt.studentId}, ${GOAL_BONUS}, 'GOAL_BONUS', ${goalKey}, NOW())
      ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id
    `;
    if (goalCredit.length > 0) {
      await tx.student.update({
        where: { id: attempt.studentId },
        data: { coinBalance: { increment: GOAL_BONUS }, lifetimeCoins: { increment: GOAL_BONUS } },
      });
      await tx.dailyProgress.update({
        where: { studentId_date: { studentId: attempt.studentId, date: dateOnly } },
        data: { goalBonusAwarded: true, goalMet: true },
      });
    }
  } else if (dp.solvedCount >= studentRow.dailyGoal) {
    await tx.dailyProgress.update({
      where: { studentId_date: { studentId: attempt.studentId, date: dateOnly } },
      data: { goalMet: true },
    });
  }

  // 5. Elo update — replays skip entirely.
  if (!attempt.isReplay && !isReplaySolve) {
    await applyEloTx(tx, attempt.studentId, attempt.puzzle.rating, 1, "SOLVED", attempt.id);
  }

  // 6. Streaks — compute the current streak from DailyProgress (the upsert in
  //    step 4 already reflects this solve) and award any newly-crossed tier
  //    bonuses (7-day +100, 30-day +250), each idempotent via its ledger key.
  const streak = await currentStreak(tx, attempt.studentId, dateOnly);
  await awardStreakBonusesTx(tx, attempt.studentId, streak);

  // 7. Badges — celebrate positive milestones. Evaluated only on SOLVED; all
  //    upserts are idempotent. `streak` is passed in to avoid re-querying.
  await evaluateBadgesTx(
    tx,
    {
      id: attempt.id,
      studentId: attempt.studentId,
      puzzleId: attempt.puzzleId,
      themes: attempt.puzzle.themes,
      createdAt: attempt.createdAt,
    },
    streak
  );

  // 8. Assignment progress — three-way fork.
  await updateAssignmentProgress(tx, attempt);

  return isReplaySolve ? 0 : reward;
}

/**
 * The assignment-progress fork. Split out so it's the single place the MANUAL /
 * FILTER / auto-queue distinction lives, and so tests can drive it directly.
 *
 * Replay neutrality (gate #15): progress is updated regardless of whether this
 * solve was a coin/elo-awarding first solve or a replay — every SOLVED attempt
 * serving an assignment counts.
 */
export async function updateAssignmentProgress(
  tx: PrismaTransaction,
  attempt: FinalizeAttempt
): Promise<void> {
  // MANUAL: this attempt serves a specific item.
  if (attempt.assignmentItemId) {
    const flippedItem = await tx.assignmentItemProgress.updateMany({
      where: { id: attempt.assignmentItemId, solved: false },
      data: { solved: true, firstSolvedAt: new Date(), attempts: { increment: 1 } },
    });
    if (flippedItem.count > 0) {
      const item = await tx.assignmentItemProgress.findUniqueOrThrow({
        where: { id: attempt.assignmentItemId },
        select: { assignmentId: true },
      });
      // Atomic increment of assignment progress (never count-and-set).
      await tx.assignment.update({
        where: { id: item.assignmentId },
        data: { progress: { increment: 1 } },
      });
      // ── GAP-FILL #1: MANUAL completion (was missing in M1). ──
      // Flip completed conditionally against the version's item count — never a
      // count-and-set. `progress` is incremented exactly once per item flip, so
      // progress == solved-item-count; comparing it to the version's total item
      // count fires completion precisely on the last solve. Idempotent via
      // `completed = false`. Matches parent spec §Finalize step 5.
      await tx.$executeRaw`
        UPDATE "Assignment" SET completed = true
        WHERE id = ${item.assignmentId}
          AND completed = false
          AND progress = (
            SELECT count(*) FROM "PuzzleSetVersionItem" vi
            WHERE vi."versionId" = (SELECT "versionId" FROM "Assignment" WHERE id = ${item.assignmentId})
          )
      `;
    }
    return;
  }

  // FILTER: assignmentId set, assignmentItemId null, targetCount present.
  if (attempt.assignmentId) {
    const assignment = await tx.assignment.findUniqueOrThrow({
      where: { id: attempt.assignmentId },
      select: { targetCount: true },
    });
    const targetCount = assignment.targetCount;
    if (targetCount == null) {
      // Defensive: an assignment with assignmentId but no item and no targetCount
      // is malformed; leave progress untouched rather than guess.
      return;
    }
    // LEAST(progress + 1, targetCount) — progress can never overshoot targetCount.
    await tx.$executeRaw`
      UPDATE "Assignment"
      SET progress = LEAST(progress + 1, ${targetCount})
      WHERE id = ${attempt.assignmentId}
    `;
    // Conditional completion — idempotent; the LEAST cap makes progress exact.
    await tx.$executeRaw`
      UPDATE "Assignment" SET completed = true
      WHERE id = ${attempt.assignmentId}
        AND progress >= ${targetCount}
        AND completed = false
    `;
    return;
  }

  // auto-queue (assignmentId == null) — no assignment progress.
}

/**
 * Apply an Elo rating update for one attempt, serialized via the Student row
 * lock. `actual` is 1 for a solve, 0 for a fail; `outcome` is the RatingEvent
 * label. Shared by the SOLVED and FAILED finalize paths (it was previously
 * duplicated nearly verbatim). Replays are skipped by the caller, not here.
 */
async function applyEloTx(
  tx: PrismaTransaction,
  studentId: string,
  puzzleRating: number,
  actual: 0 | 1,
  outcome: "SOLVED" | "FAILED",
  attemptId: string
): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM "Student" WHERE id = ${studentId} FOR UPDATE`;
  const lockedStudent = await tx.student.findUniqueOrThrow({ where: { id: studentId } });
  const ratedCount = await tx.ratingEvent.count({ where: { studentId } });
  const k = kFactorFor(ratedCount);
  const delta = eloDelta(lockedStudent.inAppRating, puzzleRating, actual, k);
  const newRating = lockedStudent.inAppRating + delta;
  const newK = kFactorFor(ratedCount + 1);

  await tx.student.update({
    where: { id: studentId },
    data: { inAppRating: newRating, ratingK: newK },
  });
  await tx.ratingEvent.create({
    data: { studentId, rating: newRating, outcome, delta, attemptId },
  });
}

/**
 * Finalize a FAILED attempt: apply Elo with actual=0 (rating drops), unless
 * this is a replay (replays skip Elo entirely per the spec). Extracted so tests
 * can drive it inside a rollback tx.
 */
export async function finalizeFailedTx(
  tx: PrismaTransaction,
  attempt: FinalizeAttempt
): Promise<void> {
  const flipped = await tx.$executeRaw`
    UPDATE "Attempt" SET status = 'FAILED', "finalizedAt" = NOW(), revision = revision + 1
    WHERE id = ${attempt.id} AND status = 'PENDING'
  `;
  if (flipped === 0) return; // race lost

  // Elo with actual=0 — but replays skip entirely.
  if (!attempt.isReplay) {
    await applyEloTx(tx, attempt.studentId, attempt.puzzle.rating, 0, "FAILED", attempt.id);
  }

  // Increment assignment item attempts (engagement tracking, not rating).
  if (attempt.assignmentItemId) {
    await tx.assignmentItemProgress.update({
      where: { id: attempt.assignmentItemId },
      data: { attempts: { increment: 1 } },
    });
  }
}
