import { eloDelta, kFactorFor } from "@/lib/rating";
import { localDateFor } from "@/lib/gamification/dates";
import { currentStreak, awardStreakBonusesTx } from "@/lib/gamification/streaks";
import { evaluateBadgesTx } from "@/lib/gamification/badges";
import { creditLedger } from "@/lib/ledger";
import { SOLVE_REWARD_NO_HINT, SOLVE_REWARD_HINTED, GOAL_BONUS } from "@/lib/economy";
import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";

/**
 * Attempt finalization — the deep coordinator that turns a terminal move into
 * its full effect on coins, rating, streaks, badges, and assignment progress.
 *
 * This module owns the *ordering* of a solve (the invariant that badges see the
 * post-solve streak, that Elo skips replays, that goal/streak bonuses credit
 * once). The gamification/rating pieces stay pure evaluators behind the seam;
 * this is the only place that composes them. The public face is two functions —
 * `recordSolve` / `recordFail` — each returning what happened.
 */

/** Wrong moves allowed before an attempt finalizes as FAILED. */
export const FAIL_LIMIT = 2;

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

/** Everything a solve produced — the interface the coordinator hides behind. */
export type SolveOutcome = {
  /** Solve reward only (0 on replay). Goal/streak bonuses land in the balance. */
  coinsAwarded: number;
  isReplay: boolean;
  /** Current streak after this solve. */
  streak: number;
  /** Badge keys newly earned by this solve. */
  badgesAwarded: string[];
  /** Elo change, or null when Elo was skipped (replay). */
  ratingDelta: number | null;
};

/** Everything a fail produced. */
export type FailOutcome = {
  ratingDelta: number | null;
};

/**
 * Finalize a SOLVED attempt in one atomic transaction. The move route wraps it
 * in `db.$transaction`; tests drive it inside a rollback tx.
 *
 * Steps:
 *  1. Conditional status flip (PENDING → SOLVED) — concurrent finalizes no-op.
 *  2. Ledger credit (first solve credits; replays get nothing).
 *  3. Write StudentPuzzle (anti-repeat) — only on solve.
 *  4. Upsert DailyProgress, award goal bonus if threshold met.
 *  5. Elo update (serialized via Student-row FOR UPDATE) — replays skip.
 *  6. Streaks — compute the post-solve streak, award any crossed-tier bonuses.
 *  7. Badges — evaluated against the post-solve streak.
 *  8. Assignment progress — MANUAL / FILTER / auto-queue fork.
 */
export async function recordSolve(
  tx: PrismaTransaction,
  attempt: FinalizeAttempt
): Promise<SolveOutcome> {
  const reward = attempt.usedHint ? SOLVE_REWARD_HINTED : SOLVE_REWARD_NO_HINT;

  // 1. Conditional status flip.
  const flipped = await tx.$executeRaw`
    UPDATE "Attempt" SET status = 'SOLVED', solved = true, "finalizedAt" = NOW(), revision = revision + 1
    WHERE id = ${attempt.id} AND status = 'PENDING'
  `;
  if (flipped === 0) {
    // Race lost — another request already finalized this attempt. Report this
    // request's (truthful) view: the coins already on the row, no new badges,
    // the current streak, no rating change.
    const existing = await tx.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
    const raceDate = localDateFor(new Date(), attempt.timezone);
    return {
      coinsAwarded: existing.coinsAwarded,
      isReplay: existing.isReplay,
      streak: await currentStreak(tx, attempt.studentId, raceDate),
      badgesAwarded: [],
      ratingDelta: null,
    };
  }

  // 2. Ledger credit. A returned false means the solve credit already existed —
  //    i.e. this puzzle was solved-for-coins before (a replay solve).
  const credited = await creditLedger(tx, {
    studentId: attempt.studentId,
    amount: reward,
    reason: attempt.usedHint ? "SOLVE_HINTED" : "SOLVE",
    idempotencyKey: `solve:${attempt.studentId}:${attempt.puzzleId}`,
    refId: attempt.id,
  });
  const isReplaySolve = !credited;

  if (!isReplaySolve) {
    await tx.attempt.update({ where: { id: attempt.id }, data: { coinsAwarded: reward } });
  } else {
    await tx.attempt.update({ where: { id: attempt.id }, data: { coinsAwarded: 0, isReplay: true } });
  }

  // 3. Write StudentPuzzle (permanent anti-repeat) — only on solve.
  await tx.$executeRaw`
    INSERT INTO "StudentPuzzle" ("studentId", "puzzleId", "firstSeenAt", "lastSeenAt", "timesSeen")
    VALUES (${attempt.studentId}, ${attempt.puzzleId}, NOW(), NOW(), 1)
    ON CONFLICT ("studentId", "puzzleId") DO UPDATE SET "lastSeenAt" = NOW(), "timesSeen" = "StudentPuzzle"."timesSeen" + 1
  `;

  // 4. DailyProgress — the student's local calendar date, so streak/daily-goal
  //    boundaries respect their timezone (an 11pm EST solve counts toward EST's
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
    const goalCredited = await creditLedger(tx, {
      studentId: attempt.studentId,
      amount: GOAL_BONUS,
      reason: "GOAL_BONUS",
      idempotencyKey: goalKey,
    });
    if (goalCredited) {
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
  let ratingDelta: number | null = null;
  if (!attempt.isReplay && !isReplaySolve) {
    ratingDelta = await applyEloTx(tx, attempt.studentId, attempt.puzzle.rating, 1, "SOLVED", attempt.id);
  }

  // 6. Streaks — compute the streak from DailyProgress (step 4 already reflects
  //    this solve) and award any newly-crossed tier bonuses.
  const streak = await currentStreak(tx, attempt.studentId, dateOnly);
  await awardStreakBonusesTx(tx, attempt.studentId, streak);

  // 7. Badges — evaluated against the post-solve streak (passed via a typed
  //    context so the dependency on step 6 is explicit, not a bare int).
  const badgesAwarded = await evaluateBadgesTx(
    tx,
    {
      id: attempt.id,
      studentId: attempt.studentId,
      puzzleId: attempt.puzzleId,
      themes: attempt.puzzle.themes,
      createdAt: attempt.createdAt,
    },
    { streak }
  );

  // 8. Assignment progress — three-way fork.
  await updateAssignmentProgress(tx, attempt);

  return {
    coinsAwarded: isReplaySolve ? 0 : reward,
    isReplay: isReplaySolve,
    streak,
    badgesAwarded,
    ratingDelta,
  };
}

/**
 * Finalize a FAILED attempt: apply Elo with actual=0 (rating drops), unless this
 * is a replay (replays skip Elo entirely per the spec).
 */
export async function recordFail(
  tx: PrismaTransaction,
  attempt: FinalizeAttempt
): Promise<FailOutcome> {
  const flipped = await tx.$executeRaw`
    UPDATE "Attempt" SET status = 'FAILED', "finalizedAt" = NOW(), revision = revision + 1
    WHERE id = ${attempt.id} AND status = 'PENDING'
  `;
  if (flipped === 0) return { ratingDelta: null }; // race lost

  let ratingDelta: number | null = null;
  if (!attempt.isReplay) {
    ratingDelta = await applyEloTx(tx, attempt.studentId, attempt.puzzle.rating, 0, "FAILED", attempt.id);
  }

  // Increment assignment item attempts (engagement tracking, not rating).
  if (attempt.assignmentItemId) {
    await tx.assignmentItemProgress.update({
      where: { id: attempt.assignmentItemId },
      data: { attempts: { increment: 1 } },
    });
  }

  return { ratingDelta };
}

/**
 * The assignment-progress fork — the single place the MANUAL / FILTER /
 * auto-queue distinction lives. Private: driven through `recordSolve`.
 *
 * Replay neutrality (gate #15): progress is updated regardless of whether this
 * solve was a coin/elo-awarding first solve or a replay — every SOLVED attempt
 * serving an assignment counts.
 */
async function updateAssignmentProgress(
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
 * label. Shared by the SOLVED and FAILED paths. Returns the applied delta.
 * Replays are skipped by the caller, not here.
 */
async function applyEloTx(
  tx: PrismaTransaction,
  studentId: string,
  puzzleRating: number,
  actual: 0 | 1,
  outcome: "SOLVED" | "FAILED",
  attemptId: string
): Promise<number> {
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
  return delta;
}
