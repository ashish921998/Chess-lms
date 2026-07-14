import { describe, it, expect } from "vitest";
import { withRollbackTx, seedFixture } from "./db-harness";
import { currentStreak, awardStreakBonusesTx } from "@/lib/gamification/streaks";

/**
 * Streak gates #9–#13. Tests `currentStreak` and the idempotent tier-bonus
 * award directly, then confirms finalize wires them together.
 *
 * Each DailyProgress row is seeded with an explicit date so the streak walker
 * is deterministic regardless of the host clock.
 */

function dateOnly(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

describe("currentStreak (gates #9–#11)", () => {
  it("counts consecutive goal-met days ending today (gate #9)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const today = dateOnly(2026, 1, 7);
      // 7 consecutive goal-met days ending Jan 7.
      for (let d = 1; d <= 7; d++) {
        await tx.dailyProgress.create({
          data: { studentId: fx.studentId, date: dateOnly(2026, 1, d), solvedCount: 5, goalMet: true },
        });
      }
      const streak = await currentStreak(tx, fx.studentId, today);
      expect(streak).toBe(7);
    });
  });

  it("counts back from yesterday when today isn't met yet (gate #10)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const today = dateOnly(2026, 1, 8);
      // Jan 5,6,7 met; Jan 8 (today) no row yet. Streak should be 3, not 0.
      for (const d of [5, 6, 7]) {
        await tx.dailyProgress.create({
          data: { studentId: fx.studentId, date: dateOnly(2026, 1, d), solvedCount: 5, goalMet: true },
        });
      }
      const streak = await currentStreak(tx, fx.studentId, today);
      expect(streak).toBe(3);
    });
  });

  it("also counts back from yesterday when today exists but isn't met (gate #10)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const today = dateOnly(2026, 1, 8);
      // Jan 6,7 met; Jan 8 (today) exists but goalMet=false (not enough solves yet).
      await tx.dailyProgress.create({
        data: { studentId: fx.studentId, date: dateOnly(2026, 1, 6), solvedCount: 5, goalMet: true },
      });
      await tx.dailyProgress.create({
        data: { studentId: fx.studentId, date: dateOnly(2026, 1, 7), solvedCount: 5, goalMet: true },
      });
      await tx.dailyProgress.create({
        data: { studentId: fx.studentId, date: dateOnly(2026, 1, 8), solvedCount: 1, goalMet: false },
      });
      const streak = await currentStreak(tx, fx.studentId, today);
      expect(streak).toBe(2); // yesterday chain, today not breaking it
    });
  });

  it("breaks at a missed (goalMet=false) day in the chain (gate #11)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const today = dateOnly(2026, 1, 7);
      // Jan 1,2 met; Jan 3 missed; Jan 4,5,6,7 met → streak 4.
      for (const d of [1, 2]) {
        await tx.dailyProgress.create({
          data: { studentId: fx.studentId, date: dateOnly(2026, 1, d), solvedCount: 5, goalMet: true },
        });
      }
      await tx.dailyProgress.create({
        data: { studentId: fx.studentId, date: dateOnly(2026, 1, 3), solvedCount: 0, goalMet: false },
      });
      for (const d of [4, 5, 6, 7]) {
        await tx.dailyProgress.create({
          data: { studentId: fx.studentId, date: dateOnly(2026, 1, d), solvedCount: 5, goalMet: true },
        });
      }
      const streak = await currentStreak(tx, fx.studentId, today);
      expect(streak).toBe(4);
    });
  });

  it("returns 0 when neither today nor yesterday is met", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const today = dateOnly(2026, 1, 5);
      // Only Jan 1 met — too far back.
      await tx.dailyProgress.create({
        data: { studentId: fx.studentId, date: dateOnly(2026, 1, 1), solvedCount: 5, goalMet: true },
      });
      const streak = await currentStreak(tx, fx.studentId, today);
      expect(streak).toBe(0);
    });
  });
});

describe("awardStreakBonusesTx (gates #12–#13)", () => {
  it("crossing streak 7 credits exactly one +100 STREAK_BONUS (gate #12)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      await awardStreakBonusesTx(tx, fx.studentId, 7);
      const bonus = await tx.coinTransaction.findUnique({
        where: { idempotencyKey: `streak:${fx.studentId}:7` },
      });
      expect(bonus).not.toBeNull();
      expect(bonus!.amount).toBe(100);
      const s = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(s.coinBalance).toBe(100);
      expect(s.lifetimeCoins).toBe(100);
    });
  });

  it("does not double-credit streak 7 on re-award (idempotency, gate #12)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      await awardStreakBonusesTx(tx, fx.studentId, 7);
      await awardStreakBonusesTx(tx, fx.studentId, 8); // re-call at a higher streak
      const s = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(s.coinBalance).toBe(100); // still only one +100
      const count = await tx.coinTransaction.count({
        where: { studentId: fx.studentId, reason: "STREAK_BONUS", amount: 100 },
      });
      expect(count).toBe(1);
    });
  });

  it("crossing streak 30 credits +250 with the streak:30 key (gate #13)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      await awardStreakBonusesTx(tx, fx.studentId, 30);
      const bonus7 = await tx.coinTransaction.findUnique({
        where: { idempotencyKey: `streak:${fx.studentId}:7` },
      });
      const bonus30 = await tx.coinTransaction.findUnique({
        where: { idempotencyKey: `streak:${fx.studentId}:30` },
      });
      expect(bonus7).not.toBeNull(); // 30 ≥ 7, so both tiers fire
      expect(bonus30).not.toBeNull();
      expect(bonus30!.amount).toBe(250);
      const s = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(s.coinBalance).toBe(100 + 250);
    });
  });

  it("awards nothing below the lowest tier", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      await awardStreakBonusesTx(tx, fx.studentId, 6);
      const count = await tx.coinTransaction.count({ where: { studentId: fx.studentId, reason: "STREAK_BONUS" } });
      expect(count).toBe(0);
    });
  });
});
