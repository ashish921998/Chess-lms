import { describe, it, expect } from "vitest";
import { withRollbackTx, seedFixture } from "./db-harness";
import { themeAccuracy } from "@/lib/tutor/student-analytics";

/**
 * Gate #35 — theme accuracy correctness. Accuracy % per theme matches the
 * solve/attempt counts (terminal attempts only).
 */
describe("themeAccuracy (gate #35)", () => {
  it("computes per-theme solved/attempted/accuracy over terminal attempts", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);

      // pz-1000-backRank themes: [backRank, mate]; pz-1100-fork themes: [fork, advantage].
      // 3 SOLVED on backRank puzzles, 1 FAILED on a fork puzzle.
      for (let i = 0; i < 3; i++) {
        await tx.attempt.create({
          data: { studentId: fx.studentId, puzzleId: "pz-1000-backRank", status: "SOLVED" },
        });
      }
      await tx.attempt.create({
        data: { studentId: fx.studentId, puzzleId: "pz-1100-fork", status: "FAILED" },
      });

      const rows = await themeAccuracy(tx, fx.studentId);
      const byTheme = new Map(rows.map((r) => [r.theme, r]));

      // backRank: 3 solved / 3 attempted → 100%.
      expect(byTheme.get("backRank")).toEqual({ theme: "backRank", solved: 3, attempted: 3, accuracy: 100 });
      // mate (also on the backRank puzzle): 3/3 → 100%.
      expect(byTheme.get("mate")).toEqual({ theme: "mate", solved: 3, attempted: 3, accuracy: 100 });
      // fork: 0/1 → 0%.
      expect(byTheme.get("fork")).toEqual({ theme: "fork", solved: 0, attempted: 1, accuracy: 0 });
      // advantage: 0/1 → 0%.
      expect(byTheme.get("advantage")).toEqual({ theme: "advantage", solved: 0, attempted: 1, accuracy: 0 });
    });
  });

  it("ignores non-terminal (PENDING) attempts", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      await tx.attempt.create({
        data: { studentId: fx.studentId, puzzleId: "pz-1500-mate", status: "SOLVED" },
      });
      await tx.attempt.create({
        data: { studentId: fx.studentId, puzzleId: "pz-1500-mate", status: "PENDING" },
      });
      const rows = await themeAccuracy(tx, fx.studentId);
      const mate = rows.find((r) => r.theme === "mate");
      // Only the SOLVED counts; PENDING is excluded.
      expect(mate?.attempted).toBe(1);
      expect(mate?.solved).toBe(1);
    });
  });

  it("returns an empty array when the student has no terminal attempts", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const rows = await themeAccuracy(tx, fx.studentId);
      expect(rows).toEqual([]);
    });
  });
});
