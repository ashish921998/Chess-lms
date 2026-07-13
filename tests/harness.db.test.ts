import { describe, it, expect } from "vitest";
import { withRollbackTx, seedFixture } from "./db-harness";

/**
 * Sanity check for the test harness itself: seed + rollback isolation. Not a
 * verification gate — just proves the plumbing before the real tests are built
 * on top of it.
 */
describe("db harness", () => {
  it("seeds a fixture inside a rollback tx", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      expect(fx.tutorId).toBe("ft-tutor");
      expect(fx.studentId).toBe("fs-student");
      expect(fx.puzzles).toHaveLength(4);
      expect(fx.puzzles.map((p) => p.rating).sort((a, b) => a - b)).toEqual([
        1000, 1100, 1500, 1900,
      ]);
    });
  });

  it("rolls back — a second tx does not see the first's data", async () => {
    // First tx creates a puzzle; rollback discards it.
    await withRollbackTx(async (tx) => {
      await tx.puzzle.create({
        data: {
          id: "rollback-canary",
          startFen: "x",
          solutionMoves: ["a2a3"],
          rating: 1000,
        },
      });
    });

    // Second tx must not find it.
    await withRollbackTx(async (tx) => {
      const found = await tx.puzzle.findUnique({
        where: { id: "rollback-canary" },
      });
      expect(found).toBeNull();
    });
  });
});
