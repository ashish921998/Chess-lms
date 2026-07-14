import { describe, it, expect } from "vitest";
import { withRollbackTx, seedFixture } from "./db-harness";
import { evaluateBadgesTx, badgeLabel, type BadgeAttempt } from "@/lib/gamification/badges";
import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";

/**
 * Badge gates #14–#20. Drives `evaluateBadgesTx` directly with hand-seeded
 * attempt histories so each badge condition is exercised in isolation.
 */

const NOW = new Date("2026-01-10T12:00:00Z");

describe("evaluateBadgesTx", () => {
  it("awards first_solve on the student's first SOLVED; not on the second (gate #14)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // No prior SOLVED attempts → first_solve fires.
      const a1 = await makeBadgeAttempt(tx, fx.studentId, "pz-1500-mate", NOW);
      let awarded = await evaluateBadgesTx(tx, a1, 0);
      expect(awarded).toContain("first_solve");

      // Add a prior SOLVED, then re-evaluate — first_solve must NOT re-fire.
      await tx.attempt.create({
        data: {
          studentId: fx.studentId,
          puzzleId: "pz-1100-fork",
          status: "SOLVED",
          createdAt: new Date("2026-01-09T12:00:00Z"),
        },
      });
      const a2 = await makeBadgeAttempt(tx, fx.studentId, "pz-1900-fork", NOW);
      awarded = await evaluateBadgesTx(tx, a2, 0);
      expect(awarded).not.toContain("first_solve");
    });
  });

  it("awards streak_7 / streak_30 when the streak crosses the threshold (gate #15)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const a = await makeBadgeAttempt(tx, fx.studentId, "pz-1500-mate", NOW);
      const awarded7 = await evaluateBadgesTx(tx, a, 7);
      expect(awarded7).toContain("streak_7");
      expect(awarded7).not.toContain("streak_30");

      const awarded30 = await evaluateBadgesTx(tx, a, 30);
      // streak_7 already awarded (no re-fire), streak_30 newly fires.
      expect(awarded30).not.toContain("streak_7");
      expect(awarded30).toContain("streak_30");
    });
  });

  it("awards centurion at 100 lifetime solves (gate #16)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // Seed 99 prior SOLVED attempts.
      for (let i = 0; i < 99; i++) {
        await tx.attempt.create({
          data: {
            studentId: fx.studentId,
            puzzleId: "pz-1500-mate",
            status: "SOLVED",
            createdAt: new Date(2025, 11, 1, 12, i, 0),
          },
        });
      }
      const a = await makeBadgeAttempt(tx, fx.studentId, "pz-1500-mate", NOW);
      const awarded = await evaluateBadgesTx(tx, a, 0);
      expect(awarded).toContain("centurion");
    });
  });

  it("awards sharpshooter when the last 10 terminal attempts are all SOLVED (gate #17)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // 9 prior SOLVED + this one = 10 clean.
      for (let i = 0; i < 9; i++) {
        await tx.attempt.create({
          data: {
            studentId: fx.studentId,
            puzzleId: "pz-1500-mate",
            status: "SOLVED",
            createdAt: new Date(2026, 0, 1, 12, i, 0),
          },
        });
      }
      const a = await makeBadgeAttempt(tx, fx.studentId, "pz-1500-mate", NOW);
      const awarded = await evaluateBadgesTx(tx, a, 0);
      expect(awarded).toContain("sharpshooter");
    });
  });

  it("does NOT award sharpshooter before 10 terminal attempts exist (gate #17)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      for (let i = 0; i < 8; i++) {
        await tx.attempt.create({
          data: {
            studentId: fx.studentId,
            puzzleId: "pz-1500-mate",
            status: "SOLVED",
            createdAt: new Date(2026, 0, 1, 12, i, 0),
          },
        });
      }
      const a = await makeBadgeAttempt(tx, fx.studentId, "pz-1500-mate", NOW);
      const awarded = await evaluateBadgesTx(tx, a, 0);
      expect(awarded).not.toContain("sharpshooter");
    });
  });

  it("does NOT award sharpshooter if any of the last 10 is FAILED (gate #17)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      for (let i = 0; i < 8; i++) {
        await tx.attempt.create({
          data: {
            studentId: fx.studentId,
            puzzleId: "pz-1500-mate",
            status: "SOLVED",
            createdAt: new Date(2026, 0, 1, 12, i, 0),
          },
        });
      }
      await tx.attempt.create({
        data: {
          studentId: fx.studentId,
          puzzleId: "pz-1100-fork",
          status: "FAILED",
          createdAt: new Date(2026, 0, 1, 13, 0, 0),
        },
      });
      const a = await makeBadgeAttempt(tx, fx.studentId, "pz-1500-mate", NOW);
      const awarded = await evaluateBadgesTx(tx, a, 0);
      expect(awarded).not.toContain("sharpshooter");
    });
  });

  it("awards theme_master_<theme> when a theme's solved count reaches 20 (gate #18)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // pz-1000-backRank has themes ["backRank","mate"]. Seed 19 prior solves on
      // backRank puzzles, then this (the 20th) fires the badge.
      for (let i = 0; i < 19; i++) {
        await tx.attempt.create({
          data: {
            studentId: fx.studentId,
            puzzleId: "pz-1000-backRank",
            status: "SOLVED",
            createdAt: new Date(2026, 0, 1, 12, i, 0),
          },
        });
      }
      const a = await makeBadgeAttempt(tx, fx.studentId, "pz-1000-backRank", NOW);
      const awarded = await evaluateBadgesTx(tx, a, 0);
      expect(awarded).toContain("theme_master_backRank");
      expect(awarded).toContain("theme_master_mate"); // mate also at 20
    });
  });

  it("awards comeback when a SOLVED follows 3 consecutive FAILED (gate #19)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      for (let i = 0; i < 3; i++) {
        await tx.attempt.create({
          data: {
            studentId: fx.studentId,
            puzzleId: "pz-1500-mate",
            status: "FAILED",
            createdAt: new Date(2026, 0, 9, 12, i, 0),
          },
        });
      }
      const a = await makeBadgeAttempt(tx, fx.studentId, "pz-1500-mate", NOW);
      const awarded = await evaluateBadgesTx(tx, a, 0);
      expect(awarded).toContain("comeback");
    });
  });

  it("does not award comeback unless the 3 preceding are all FAILED", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      await tx.attempt.create({
        data: {
          studentId: fx.studentId,
          puzzleId: "pz-1500-mate",
          status: "FAILED",
          createdAt: new Date(2026, 0, 9, 12, 0, 0),
        },
      });
      await tx.attempt.create({
        data: {
          studentId: fx.studentId,
          puzzleId: "pz-1500-mate",
          status: "SOLVED", // breaks the fail chain
          createdAt: new Date(2026, 0, 9, 12, 1, 0),
        },
      });
      await tx.attempt.create({
        data: {
          studentId: fx.studentId,
          puzzleId: "pz-1500-mate",
          status: "FAILED",
          createdAt: new Date(2026, 0, 9, 12, 2, 0),
        },
      });
      const a = await makeBadgeAttempt(tx, fx.studentId, "pz-1500-mate", NOW);
      const awarded = await evaluateBadgesTx(tx, a, 0);
      expect(awarded).not.toContain("comeback");
    });
  });

  it("re-evaluating does not duplicate StudentBadge rows (gate #20)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const a = await makeBadgeAttempt(tx, fx.studentId, "pz-1500-mate", NOW);
      await evaluateBadgesTx(tx, a, 0);
      await evaluateBadgesTx(tx, a, 0); // re-run
      const rows = await tx.studentBadge.findMany({ where: { studentId: fx.studentId } });
      expect(rows.length).toBe(1);
      expect(rows[0].badgeKey).toBe("first_solve");
    });
  });
});

describe("badgeLabel", () => {
  it("labels fixed badges and theme_master_* keys", () => {
    expect(badgeLabel("first_solve")).toBe("First Solve");
    expect(badgeLabel("theme_master_backRank")).toBe("Theme Master · backRank");
  });
});

async function makeBadgeAttempt(
  tx: PrismaTransaction,
  studentId: string,
  puzzleId: string,
  createdAt: Date
): Promise<BadgeAttempt> {
  const puzzle = await tx.puzzle.findUniqueOrThrow({ where: { id: puzzleId } });
  return {
    id: `badge-${studentId}-${puzzleId}-${Math.random().toString(36).slice(2, 8)}`,
    studentId,
    puzzleId,
    themes: puzzle.themes,
    createdAt,
  };
}
