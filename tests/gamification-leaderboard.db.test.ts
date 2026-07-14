import { describe, it, expect } from "vitest";
import { withRollbackTx, seedFixture } from "./db-harness";
import { classLeaderboard } from "@/lib/gamification/leaderboard";

/**
 * Gate #21 — leaderboard ranking. Students ordered by lifetimeCoins DESC, then
 * solvedCount DESC, then id ASC. Display names only (no emails surfaced).
 */
describe("classLeaderboard (gate #21)", () => {
  it("ranks by lifetimeCoins DESC, tie-broken by solvedCount DESC then id ASC", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);

      // A third student for a richer ranking.
      const s3 = await tx.user.create({
        data: {
          id: "s3-user",
          email: "s3@example.com",
          role: "STUDENT",
          emailVerified: true,
          student: {
            create: { id: "s3-student", tutorId: fx.tutorId, displayName: "S Three", inAppRating: 1500 },
          },
        },
        include: { student: true },
      });

      // student1: 50 lifetime, 1 solve.
      await tx.student.update({ where: { id: fx.studentId }, data: { lifetimeCoins: 50 } });
      await tx.attempt.create({
        data: { studentId: fx.studentId, puzzleId: "pz-1500-mate", status: "SOLVED" },
      });
      // student2: 100 lifetime, 2 solves.
      await tx.student.update({ where: { id: fx.student2Id }, data: { lifetimeCoins: 100 } });
      await tx.attempt.create({
        data: { studentId: fx.student2Id, puzzleId: "pz-1500-mate", status: "SOLVED" },
      });
      await tx.attempt.create({
        data: { studentId: fx.student2Id, puzzleId: "pz-1100-fork", status: "SOLVED" },
      });
      // student3: 0 lifetime, 0 solves.
      void s3;

      const board = await classLeaderboard(tx, fx.tutorId);

      // 100 > 50 > 0 ordering.
      expect(board.map((r) => r.lifetimeCoins)).toEqual([100, 50, 0]);
      expect(board[0].id).toBe(fx.student2Id);
      expect(board[1].id).toBe(fx.studentId);
      expect(board[2].id).toBe("s3-student");

      // solvedCount is the secondary signal.
      expect(board[0].solvedCount).toBe(2);
      expect(board[1].solvedCount).toBe(1);
      expect(board[2].solvedCount).toBe(0);
    });
  });

  it("tie-breaks equal lifetimeCoins by solvedCount DESC then id ASC", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);

      // Equal lifetime (100), but student2 has more solves → ranks first.
      await tx.student.update({ where: { id: fx.studentId }, data: { lifetimeCoins: 100 } });
      await tx.student.update({ where: { id: fx.student2Id }, data: { lifetimeCoins: 100 } });
      await tx.attempt.create({
        data: { studentId: fx.studentId, puzzleId: "pz-1500-mate", status: "SOLVED" },
      });
      await tx.attempt.create({
        data: { studentId: fx.student2Id, puzzleId: "pz-1500-mate", status: "SOLVED" },
      });
      await tx.attempt.create({
        data: { studentId: fx.student2Id, puzzleId: "pz-1100-fork", status: "SOLVED" },
      });

      const board = await classLeaderboard(tx, fx.tutorId);
      expect(board[0].id).toBe(fx.student2Id); // more solves wins the tie
      expect(board[1].id).toBe(fx.studentId);
    });
  });

  it("scopes to the tutor's roster and returns display names only (no emails)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // A student of a DIFFERENT tutor must not appear.
      const otherStudent = await tx.user.create({
        data: {
          id: "other-s-user",
          email: "other@example.com",
          role: "STUDENT",
          emailVerified: true,
          student: {
            create: { id: "other-student", tutorId: fx.tutor2Id, displayName: "Other", lifetimeCoins: 999 },
          },
        },
        include: { student: true },
      });

      const board = await classLeaderboard(tx, fx.tutorId);
      expect(board.every((r) => r.id !== otherStudent.student!.id)).toBe(true);
      // No email field is returned at all.
      expect(board.every((r) => !("email" in r))).toBe(true);
    });
  });
});
