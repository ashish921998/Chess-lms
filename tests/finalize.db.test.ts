import { describe, it, expect } from "vitest";
import { withRollbackTx, seedFixture } from "./db-harness";
import { recordSolve, type FinalizeAttempt } from "@/lib/attempts/finalize";
import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";

/**
 * DB integration tests for the finalize fork + gap-fills (gates #7, #8, #9,
 * #15, #17). Drives `recordSolve` directly inside a rollback tx.
 *
 * Concurrency note (gate #7): true parallel races aren't reproducible under a
 * single rollback transaction, so the LEAST cap is asserted by sequential
 * double-increment AND by the SQL algebra (LEAST(progress+1, target) can never
 * exceed target). See tests/README.md.
 */

const START_FEN =
  "r1bqkbnr/p1pp1ppp/1pn5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 2";

/** Build a fresh PENDING attempt row + the FinalizeAttempt shape finalize needs. */
async function makeAttempt(
  tx: PrismaTransaction,
  studentId: string,
  puzzleId: string,
  opts: { assignmentId?: string | null; assignmentItemId?: string | null; isReplay?: boolean } = {}
) {
  const row = await tx.attempt.create({
    data: {
      studentId,
      puzzleId,
      status: "PENDING",
      isReplay: opts.isReplay ?? false,
      assignmentId: opts.assignmentId ?? null,
      assignmentItemId: opts.assignmentItemId ?? null,
    },
  });
  const puzzle = await tx.puzzle.findUniqueOrThrow({ where: { id: puzzleId } });
  const attempt: FinalizeAttempt = {
    id: row.id,
    puzzleId,
    studentId,
    usedHint: false,
    isReplay: opts.isReplay ?? false,
    assignmentId: opts.assignmentId ?? null,
    assignmentItemId: opts.assignmentItemId ?? null,
    timezone: "UTC",
    createdAt: row.createdAt,
    puzzle: {
      rating: puzzle.rating,
      startFen: START_FEN,
      solutionMoves: puzzle.solutionMoves,
      themes: puzzle.themes,
    },
  };
  return { row, attempt };
}

describe("recordSolve — auto-queue (gate #17 regression)", () => {
  it("an auto-queue solve (assignmentId == null) does not touch any assignment", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const { attempt } = await makeAttempt(tx, fx.studentId, "pz-1500-mate");

      await recordSolve(tx, attempt);

      const a = await tx.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(a.status).toBe("SOLVED");
      expect(a.coinsAwarded).toBe(10);
      // No assignment exists, so this is trivially fine — the guard is that the
      // fork does not error on a null assignmentId.
      const assignmentCount = await tx.assignment.count();
      expect(assignmentCount).toBe(0);
    });
  });
});

describe("recordSolve — MANUAL (gates #8, #9)", () => {
  it("solving a non-last item does NOT complete the assignment (gate #8)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // Build a MANUAL set → version → assignment with 2 items.
      const { assignment, items } = await buildManualAssignment(tx, fx, [
        "pz-1000-backRank",
        "pz-1100-fork",
      ]);

      // Issue + solve the FIRST item only.
      const { attempt } = await makeAttempt(tx, fx.studentId, "pz-1000-backRank", {
        assignmentId: assignment.id,
        assignmentItemId: items[0].id,
      });
      await recordSolve(tx, attempt);

      const a = await tx.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
      expect(a.progress).toBe(1);
      expect(a.completed).toBe(false); // not the last item
    });
  });

  it("solving the LAST item flips completed exactly once (gate #8)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const { assignment, items } = await buildManualAssignment(tx, fx, [
        "pz-1000-backRank",
        "pz-1100-fork",
      ]);

      // Solve item 1.
      {
        const { attempt } = await makeAttempt(tx, fx.studentId, "pz-1000-backRank", {
          assignmentId: assignment.id,
          assignmentItemId: items[0].id,
        });
        await recordSolve(tx, attempt);
      }
      // Solve item 2 — the last.
      {
        const { attempt } = await makeAttempt(tx, fx.studentId, "pz-1100-fork", {
          assignmentId: assignment.id,
          assignmentItemId: items[1].id,
        });
        await recordSolve(tx, attempt);
      }

      const a = await tx.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
      expect(a.progress).toBe(2);
      expect(a.completed).toBe(true);
    });
  });

  it("MANUAL item flip + atomic progress increment untouched (gate #9 regression)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const { assignment, items } = await buildManualAssignment(tx, fx, [
        "pz-1500-mate",
      ]);

      const { attempt } = await makeAttempt(tx, fx.studentId, "pz-1500-mate", {
        assignmentId: assignment.id,
        assignmentItemId: items[0].id,
      });
      await recordSolve(tx, attempt);

      const item = await tx.assignmentItemProgress.findUniqueOrThrow({
        where: { id: items[0].id },
      });
      expect(item.solved).toBe(true);
      expect(item.firstSolvedAt).not.toBeNull();

      const a = await tx.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
      expect(a.progress).toBe(1);
      expect(a.completed).toBe(true); // single-item assignment completes on its only solve
    });
  });
});

describe("recordSolve — FILTER (gates #7, #15)", () => {
  it("progress is capped at targetCount and never overshoots (gate #7)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const { assignment } = await buildFilterAssignment(tx, fx, 2); // targetCount = 2

      // Solve #1.
      {
        const { attempt } = await makeAttempt(tx, fx.studentId, "pz-1500-mate", {
          assignmentId: assignment.id,
          assignmentItemId: null,
        });
        await recordSolve(tx, attempt);
      }
      // Solve #2 — reaches the target.
      {
        const { attempt } = await makeAttempt(tx, fx.studentId, "pz-1000-backRank", {
          assignmentId: assignment.id,
          assignmentItemId: null,
        });
        await recordSolve(tx, attempt);
      }
      let a = await tx.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
      expect(a.progress).toBe(2);
      expect(a.completed).toBe(true);

      // Solve #3 past the target — the LEAST cap must hold: progress stays 2.
      {
        const { attempt } = await makeAttempt(tx, fx.studentId, "pz-1100-fork", {
          assignmentId: assignment.id,
          assignmentItemId: null,
        });
        await recordSolve(tx, attempt);
      }
      a = await tx.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
      expect(a.progress).toBe(2); // capped, never 3
    });
  });

  it("a replay FILTER puzzle counts toward targetCount but awards no coins (gate #15)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const { assignment } = await buildFilterAssignment(tx, fx, 1);

      // Pretend the student already solved pz-1500-mate globally.
      await tx.studentPuzzle.create({
        data: { studentId: fx.studentId, puzzleId: "pz-1500-mate" },
      });

      const { attempt } = await makeAttempt(tx, fx.studentId, "pz-1500-mate", {
        assignmentId: assignment.id,
        assignmentItemId: null,
        isReplay: true,
      });
      const outcome = await recordSolve(tx, attempt);

      expect(outcome.coinsAwarded).toBe(0); // replay — no coins
      const a = await tx.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
      expect(a.progress).toBe(1); // but it still counts → completes
      expect(a.completed).toBe(true);
    });
  });
});

// ── Fixture builders ──

async function buildManualAssignment(
  tx: PrismaTransaction,
  fx: { tutorId: string; studentId: string },
  puzzleIds: string[]
) {
  const set = await tx.puzzleSet.create({
    data: { tutorId: fx.tutorId, title: "MANUAL set", mode: "MANUAL" },
  });
  // Draft items (the set's own PuzzleSetItem) — not strictly needed for the
  // version, but mirrors the real publish flow.
  for (let i = 0; i < puzzleIds.length; i++) {
    await tx.puzzleSetItem.create({
      data: { setId: set.id, puzzleId: puzzleIds[i], order: i },
    });
  }
  const version = await tx.puzzleSetVersion.create({
    data: { setId: set.id, version: 1, mode: "MANUAL" },
  });
  // Version items — what assignments materialize from.
  const versionItems = [];
  for (let i = 0; i < puzzleIds.length; i++) {
    versionItems.push(
      await tx.puzzleSetVersionItem.create({
        data: { versionId: version.id, puzzleId: puzzleIds[i], order: i },
      })
    );
  }
  const assignment = await tx.assignment.create({
    data: { versionId: version.id, studentId: fx.studentId },
  });
  const items = [];
  for (let i = 0; i < versionItems.length; i++) {
    items.push(
      await tx.assignmentItemProgress.create({
        data: {
          assignmentId: assignment.id,
          puzzleId: puzzleIds[i],
          order: i,
        },
      })
    );
  }
  return { set, version, versionItems, assignment, items };
}

async function buildFilterAssignment(
  tx: PrismaTransaction,
  fx: { tutorId: string; studentId: string },
  targetCount: number
) {
  const set = await tx.puzzleSet.create({
    data: {
      tutorId: fx.tutorId,
      title: "FILTER set",
      mode: "FILTER",
      filterThemes: [],
      filterRatingMin: 900,
      filterRatingMax: 2000,
      targetCount,
    },
  });
  const version = await tx.puzzleSetVersion.create({
    data: {
      setId: set.id,
      version: 1,
      mode: "FILTER",
      filterThemes: [],
      filterRatingMin: 900,
      filterRatingMax: 2000,
      targetCount,
    },
  });
  const assignment = await tx.assignment.create({
    data: { versionId: version.id, studentId: fx.studentId, targetCount },
  });
  return { set, version, assignment };
}
