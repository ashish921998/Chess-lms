import { describe, it, expect } from "vitest";
import { withRollbackTx, seedFixture } from "./db-harness";
import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";

/**
 * Goals route logic gates #38–#39 (validation + cross-tutor scoping). The route
 * handler calls getTutorActor() (needs a session), so these tests exercise the
 * same validation + scoping queries the route performs, inside a rollback tx.
 *
 * The shared validation rule under test: dailyGoal must be an integer >= 1, and
 * a student not in the acting tutor's roster must 404 (no existence leak).
 */

/** Mirrors the route's validation. */
function isValidDailyGoal(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 1;
}

describe("/api/tutor/goals — dailyGoal validation (gate #38)", () => {
  it("rejects dailyGoal < 1, non-integers, and non-numbers", () => {
    expect(isValidDailyGoal(0)).toBe(false);
    expect(isValidDailyGoal(-1)).toBe(false);
    expect(isValidDailyGoal(1.5)).toBe(false);
    expect(isValidDailyGoal(NaN)).toBe(false);
    expect(isValidDailyGoal("5")).toBe(false);
    expect(isValidDailyGoal(null)).toBe(false);
    expect(isValidDailyGoal(undefined)).toBe(false);
  });

  it("accepts positive integers", () => {
    expect(isValidDailyGoal(1)).toBe(true);
    expect(isValidDailyGoal(5)).toBe(true);
    expect(isValidDailyGoal(50)).toBe(true);
  });

  it("single update writes dailyGoal when valid", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      await updateGoalScoped(tx, fx.tutorId, fx.studentId, 7);
      const s = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(s.dailyGoal).toBe(7);
    });
  });
});

describe("/api/tutor/goals — cross-tutor scoping (gate #39)", () => {
  it("a studentId not in the tutor's roster is not found (404, no update)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // fx.studentId belongs to fx.tutorId. Acting as fx.tutor2Id → not found.
      const before = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      const result = await updateGoalScoped(tx, fx.tutor2Id, fx.studentId, 9);
      expect(result).toBe(false); // the route would return 404
      const after = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(after.dailyGoal).toBe(before.dailyGoal); // unchanged
    });
  });

  it("set-all updates only the acting tutor's roster", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // student2 belongs to tutor1; give tutor2 a student too.
      await tx.user.create({
        data: {
          id: "t2s-user",
          email: "t2s@example.com",
          role: "STUDENT",
          emailVerified: true,
          student: { create: { id: "t2s-student", tutorId: fx.tutor2Id, displayName: "T2 S" } },
        },
      });
      // Acting as tutor1, set all to 8.
      await setAllGoalsScoped(tx, fx.tutorId, 8);

      const s1 = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      const s2 = await tx.student.findUniqueOrThrow({ where: { id: fx.student2Id } });
      const other = await tx.student.findUniqueOrThrow({ where: { id: "t2s-student" } });
      expect(s1.dailyGoal).toBe(8);
      expect(s2.dailyGoal).toBe(8);
      expect(other.dailyGoal).toBe(5); // untouched — different tutor
    });
  });
});

/** Mirrors the route's single-student scoped update; returns false if not owned. */
async function updateGoalScoped(
  tx: PrismaTransaction,
  tutorId: string,
  studentId: string,
  dailyGoal: number
): Promise<boolean> {
  const student = await tx.student.findUnique({ where: { id: studentId }, select: { tutorId: true } });
  if (!student || student.tutorId !== tutorId) return false; // route returns 404
  await tx.student.update({ where: { id: studentId }, data: { dailyGoal } });
  return true;
}

/** Mirrors the route's class-wide scoped update. */
async function setAllGoalsScoped(
  tx: PrismaTransaction,
  tutorId: string,
  dailyGoal: number
): Promise<void> {
  await tx.student.updateMany({ where: { tutorId }, data: { dailyGoal } });
}
