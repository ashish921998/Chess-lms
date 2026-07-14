import { describe, it, expect } from "vitest";
import { localDateFor } from "@/lib/gamification/dates";
import { withRollbackTx, seedFixture } from "./db-harness";
import { finalizeSolvedTx, type FinalizeAttempt } from "@/lib/puzzles/finalize";
import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";

/**
 * Gate #1 (timezone correctness) + a unit check on localDateFor.
 *
 * `formatInTimeZone` reads the wall-clock instant; we assert the algebra directly
 * so the test is stable regardless of the host machine's own timezone.
 */
describe("localDateFor (gate #1 — unit)", () => {
  it("a 11pm EST instant (UTC-5) maps to the EST calendar date, not the UTC date", () => {
    // 2026-01-06 04:00:00 UTC == 2026-01-06 00:00 EST is a clean boundary, so
    // use an unambiguous one: 2026-01-05 23:30 EST == 2026-01-06 04:30 UTC.
    const instant = new Date("2026-01-06T04:30:00Z");
    const local = localDateFor(instant, "America/New_York");
    // The local calendar date is Jan 5 — must NOT roll to Jan 6 (the UTC date).
    expect(local.getUTCFullYear()).toBe(2026);
    expect(local.getUTCMonth()).toBe(0); // January
    expect(local.getUTCDate()).toBe(5);
  });

  it("handles DST: a summer EST instant (UTC-4) still maps to the local date", () => {
    // 2026-07-05 23:30 EDT (UTC-4) == 2026-07-06 03:30 UTC.
    const instant = new Date("2026-07-06T03:30:00Z");
    const local = localDateFor(instant, "America/New_York");
    expect(local.getUTCMonth()).toBe(6); // July
    expect(local.getUTCDate()).toBe(5);
  });

  it("UTC instants map to their own calendar date", () => {
    const instant = new Date("2026-01-06T10:00:00Z");
    const local = localDateFor(instant, "UTC");
    expect(local.getUTCDate()).toBe(6);
  });
});

describe("finalizeSolvedTx — DailyProgress uses the student's local date (gate #1)", () => {
  it("a solve writes DailyProgress for the timezone-correct local date", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // Set the student to New York time and give them a non-default daily goal
      // so the goal-met path is exercised deterministically.
      await tx.student.update({
        where: { id: fx.studentId },
        data: { timezone: "America/New_York", dailyGoal: 1 },
      });

      const attempt = await makeAttempt(tx, fx.studentId, "pz-1500-mate", "America/New_York");
      await finalizeSolvedTx(tx, attempt);

      // Today in NY as a date-only key.
      const nyToday = localDateFor(new Date(), "America/New_York");

      const dp = await tx.dailyProgress.findUnique({
        where: { studentId_date: { studentId: fx.studentId, date: nyToday } },
      });
      expect(dp).not.toBeNull();
      expect(dp!.solvedCount).toBe(1);
    });
  });
});

async function makeAttempt(
  tx: PrismaTransaction,
  studentId: string,
  puzzleId: string,
  timezone: string
): Promise<FinalizeAttempt> {
  const row = await tx.attempt.create({
    data: { studentId, puzzleId, status: "PENDING" },
  });
  const puzzle = await tx.puzzle.findUniqueOrThrow({ where: { id: puzzleId } });
  return {
    id: row.id,
    puzzleId,
    studentId,
    usedHint: false,
    isReplay: false,
    assignmentId: null,
    assignmentItemId: null,
    timezone,
    createdAt: row.createdAt,
    puzzle: {
      rating: puzzle.rating,
      startFen: puzzle.startFen,
      solutionMoves: puzzle.solutionMoves,
      themes: puzzle.themes,
    },
  };
}
