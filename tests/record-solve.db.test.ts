import { describe, it, expect } from "vitest";
import { withRollbackTx, seedFixture } from "./db-harness";
import { recordSolve, recordFail, type FinalizeAttempt } from "@/lib/attempts/finalize";
import { localDateFor } from "@/lib/gamification/dates";
import {
  SOLVE_REWARD_NO_HINT,
  GOAL_BONUS,
  STREAK_TIERS,
} from "@/lib/economy";
import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";

/**
 * End-to-end coordinator tests: drive `recordSolve` / `recordFail` and assert
 * the whole SolveOutcome/FailOutcome AND that the DB agrees (balance, ledger,
 * badges, rating events). This is the composition test the finalize path lacked
 * — the per-evaluator tests (badges/streaks/spend) cover the pieces in
 * isolation; this covers them wired together in one solve.
 */

function addDaysUTC(d: Date, n: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + n);
  return next;
}

async function makeAutoQueueAttempt(
  tx: PrismaTransaction,
  studentId: string,
  puzzleId: string,
  opts: { usedHint?: boolean; isReplay?: boolean } = {}
): Promise<FinalizeAttempt> {
  const row = await tx.attempt.create({
    data: { studentId, puzzleId, status: "PENDING", isReplay: opts.isReplay ?? false },
  });
  const puzzle = await tx.puzzle.findUniqueOrThrow({ where: { id: puzzleId } });
  return {
    id: row.id,
    puzzleId,
    studentId,
    usedHint: opts.usedHint ?? false,
    isReplay: opts.isReplay ?? false,
    assignmentId: null,
    assignmentItemId: null,
    timezone: "UTC",
    createdAt: row.createdAt,
    puzzle: {
      rating: puzzle.rating,
      startFen: puzzle.startFen,
      solutionMoves: puzzle.solutionMoves,
      themes: puzzle.themes,
    },
  };
}

describe("recordSolve — full outcome (coins + goal + streak + badges + rating)", () => {
  it("a solve that crosses the daily goal AND a 7-day streak reports and persists all effects", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // Daily goal of 1 so a single solve meets it.
      await tx.student.update({ where: { id: fx.studentId }, data: { dailyGoal: 1 } });

      // Six consecutive goal-met days ending yesterday → today's solve makes 7.
      const today = localDateFor(new Date(), "UTC");
      for (let i = 1; i <= 6; i++) {
        await tx.dailyProgress.create({
          data: {
            studentId: fx.studentId,
            date: addDaysUTC(today, -i),
            solvedCount: 1,
            goalMet: true,
            goalBonusAwarded: true,
          },
        });
      }

      const before = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });

      const attempt = await makeAutoQueueAttempt(tx, fx.studentId, "pz-1500-mate");
      const outcome = await recordSolve(tx, attempt);

      // ── Returned outcome ──
      expect(outcome.coinsAwarded).toBe(SOLVE_REWARD_NO_HINT); // solve reward only
      expect(outcome.isReplay).toBe(false);
      expect(outcome.streak).toBe(7);
      expect(outcome.badgesAwarded).toEqual(
        expect.arrayContaining(["first_solve", "streak_7"])
      );
      expect(outcome.ratingDelta).not.toBeNull();
      expect(typeof outcome.ratingDelta).toBe("number");

      // ── DB agrees: balance = solve + goal bonus + 7-day streak tier ──
      const streak7Bonus = STREAK_TIERS.find((t) => t.days === 7)!.bonus;
      const expectedGain = SOLVE_REWARD_NO_HINT + GOAL_BONUS + streak7Bonus;
      const after = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(after.coinBalance).toBe(before.coinBalance + expectedGain);
      expect(after.lifetimeCoins).toBe(before.lifetimeCoins + expectedGain);

      // Ledger has exactly the three credit rows for this solve.
      const reasons = (
        await tx.coinTransaction.findMany({
          where: { studentId: fx.studentId },
          select: { reason: true },
        })
      ).map((r) => r.reason).sort();
      expect(reasons).toEqual(["GOAL_BONUS", "SOLVE", "STREAK_BONUS"]);

      // Badges persisted.
      const badges = (
        await tx.studentBadge.findMany({
          where: { studentId: fx.studentId },
          select: { badgeKey: true },
        })
      ).map((b) => b.badgeKey);
      expect(badges).toEqual(expect.arrayContaining(["first_solve", "streak_7"]));

      // Rating event recorded, matching the returned delta.
      const ratingEvents = await tx.ratingEvent.findMany({ where: { studentId: fx.studentId } });
      expect(ratingEvents).toHaveLength(1);
      expect(ratingEvents[0].outcome).toBe("SOLVED");
      expect(ratingEvents[0].delta).toBe(outcome.ratingDelta);
    });
  });

  it("a replay solve awards no coins and skips rating, but still reports the streak", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // Mark the solve credit as already earned so this solve is a replay.
      await tx.coinTransaction.create({
        data: {
          studentId: fx.studentId,
          amount: SOLVE_REWARD_NO_HINT,
          reason: "SOLVE",
          idempotencyKey: `solve:${fx.studentId}:pz-1500-mate`,
        },
      });
      const before = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });

      const attempt = await makeAutoQueueAttempt(tx, fx.studentId, "pz-1500-mate");
      const outcome = await recordSolve(tx, attempt);

      expect(outcome.coinsAwarded).toBe(0);
      expect(outcome.isReplay).toBe(true);
      expect(outcome.ratingDelta).toBeNull();

      const after = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(after.coinBalance).toBe(before.coinBalance); // no new coins
      const ratingEvents = await tx.ratingEvent.count({ where: { studentId: fx.studentId } });
      expect(ratingEvents).toBe(0); // replay skips Elo
    });
  });
});

describe("recordFail — outcome", () => {
  it("a non-replay fail drops rating and reports the delta", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const attempt = await makeAutoQueueAttempt(tx, fx.studentId, "pz-1500-mate");

      const outcome = await recordFail(tx, attempt);

      const a = await tx.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(a.status).toBe("FAILED");
      expect(outcome.ratingDelta).not.toBeNull();
      expect(outcome.ratingDelta!).toBeLessThan(0); // a fail lowers rating

      const events = await tx.ratingEvent.findMany({ where: { studentId: fx.studentId } });
      expect(events).toHaveLength(1);
      expect(events[0].outcome).toBe("FAILED");
    });
  });

  it("a replay fail skips rating entirely", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const attempt = await makeAutoQueueAttempt(tx, fx.studentId, "pz-1500-mate", {
        isReplay: true,
      });

      const outcome = await recordFail(tx, attempt);

      expect(outcome.ratingDelta).toBeNull();
      const events = await tx.ratingEvent.count({ where: { studentId: fx.studentId } });
      expect(events).toBe(0);
    });
  });
});
