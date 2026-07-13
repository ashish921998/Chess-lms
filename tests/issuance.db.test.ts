import { describe, it, expect } from "vitest";
import { withRollbackTx, seedFixture } from "./db-harness";
import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";
import { pickManualItem, selectFilterPuzzle } from "@/lib/puzzles/assignment-issuance";

/**
 * Issuance-flow tests (gates #11, #12, #16). These replicate the
 * /sets/[assignmentId] server-component's issuance transaction: lock student →
 * check PENDING → resume (same assignment) / abandon (different/auto-queue) →
 * issue via pickManualItem / selectFilterPuzzle. Driving the actual page handler
 * under Vitest isn't practical, so the test re-runs the same sequence against
 * the same helpers the page uses.
 */

/** Mirror of the page's PENDING prelude: resume same-assignment, abandon rest. */
async function issueForAssignment(
  tx: PrismaTransaction,
  studentId: string,
  assignmentId: string,
  mode: "MANUAL" | "FILTER"
): Promise<{ kind: "resume"; attemptId: string } | { kind: "issued"; attemptId: string } | { kind: "complete" }> {
  await tx.$executeRaw`SELECT 1 FROM "Student" WHERE id = ${studentId} FOR UPDATE`;
  const existing = await tx.attempt.findFirst({
    where: { studentId, status: "PENDING" },
  });
  if (existing) {
    if (existing.assignmentId === assignmentId) {
      return { kind: "resume", attemptId: existing.id };
    }
    await tx.attempt.update({
      where: { id: existing.id },
      data: { status: "ABANDONED", finalizedAt: new Date() },
    });
  }

  const r = mode === "MANUAL" ? await pickManualItem(tx, assignmentId, studentId) : await selectFilterPuzzle(tx, assignmentId, studentId);
  if (r.kind === "COMPLETE") return { kind: "complete" };
  const attempt = await tx.attempt.create({
    data: {
      studentId,
      puzzleId: r.puzzle.id,
      status: "PENDING",
      isReplay: r.isReplay,
      assignmentId,
      assignmentItemId: r.kind === "MANUAL" ? r.assignmentItemId : null,
    },
  });
  return { kind: "issued", attemptId: attempt.id };
}

async function buildManual(
  tx: PrismaTransaction,
  fx: { tutorId: string; studentId: string },
  puzzleIds: string[]
) {
  const set = await tx.puzzleSet.create({ data: { tutorId: fx.tutorId, title: "M", mode: "MANUAL" } });
  for (let i = 0; i < puzzleIds.length; i++) {
    await tx.puzzleSetItem.create({ data: { setId: set.id, puzzleId: puzzleIds[i], order: i } });
  }
  const version = await tx.puzzleSetVersion.create({ data: { setId: set.id, version: 1, mode: "MANUAL" } });
  for (let i = 0; i < puzzleIds.length; i++) {
    await tx.puzzleSetVersionItem.create({ data: { versionId: version.id, puzzleId: puzzleIds[i], order: i } });
  }
  const assignment = await tx.assignment.create({ data: { versionId: version.id, studentId: fx.studentId } });
  for (let i = 0; i < puzzleIds.length; i++) {
    await tx.assignmentItemProgress.create({ data: { assignmentId: assignment.id, puzzleId: puzzleIds[i], order: i } });
  }
  return { set, version, assignment };
}

async function buildFilter(
  tx: PrismaTransaction,
  fx: { tutorId: string; studentId: string },
  opts: { targetCount: number; ratingMin: number; ratingMax: number }
) {
  const set = await tx.puzzleSet.create({
    data: { tutorId: fx.tutorId, title: "F", mode: "FILTER", filterRatingMin: opts.ratingMin, filterRatingMax: opts.ratingMax, targetCount: opts.targetCount },
  });
  const version = await tx.puzzleSetVersion.create({
    data: { setId: set.id, version: 1, mode: "FILTER", filterRatingMin: opts.ratingMin, filterRatingMax: opts.ratingMax, targetCount: opts.targetCount },
  });
  const assignment = await tx.assignment.create({ data: { versionId: version.id, studentId: fx.studentId, targetCount: opts.targetCount } });
  return { set, version, assignment };
}

describe("issuance — context switch (gate #11)", () => {
  it("opening an assignment with a PENDING auto-queue attempt abandons it", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const { assignment } = await buildManual(tx, fx, ["pz-1500-mate", "pz-1000-backRank"]);

      // Student has an in-flight auto-queue attempt (assignmentId null).
      const auto = await tx.attempt.create({
        data: { studentId: fx.studentId, puzzleId: "pz-1100-fork", status: "PENDING" },
      });

      const r = await issueForAssignment(tx, fx.studentId, assignment.id, "MANUAL");
      expect(r.kind).toBe("issued");

      // The auto-queue attempt was abandoned; a new assignment attempt exists.
      const refreshed = await tx.attempt.findUniqueOrThrow({ where: { id: auto.id } });
      expect(refreshed.status).toBe("ABANDONED");
    });
  });

  it("opening assignment B with a PENDING attempt for assignment A abandons A's", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const a = await buildManual(tx, fx, ["pz-1500-mate"]);
      const b = await buildFilter(tx, fx, { targetCount: 5, ratingMin: 1000, ratingMax: 2000 });

      // Start A.
      const r1 = await issueForAssignment(tx, fx.studentId, a.assignment.id, "MANUAL");
      expect(r1.kind).toBe("issued");
      // Open B — A's PENDING should be abandoned.
      const r2 = await issueForAssignment(tx, fx.studentId, b.assignment.id, "FILTER");
      expect(r2.kind).toBe("issued");

      if (r1.kind === "issued") {
        const aAttempt = await tx.attempt.findUniqueOrThrow({ where: { id: r1.attemptId } });
        expect(aAttempt.status).toBe("ABANDONED");
      }
    });
  });
});

describe("issuance — resume (gate #12)", () => {
  it("re-opening the same assignment resumes the PENDING attempt", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const { assignment } = await buildManual(tx, fx, ["pz-1500-mate", "pz-1000-backRank"]);

      const first = await issueForAssignment(tx, fx.studentId, assignment.id, "MANUAL");
      expect(first.kind).toBe("issued");
      if (first.kind !== "issued") return;

      // Advance the cursor (mid-line), as if the student played a move.
      await tx.attempt.update({ where: { id: first.attemptId }, data: { moveIndex: 2 } });

      // Re-open → resume the SAME attempt, not a new one.
      const second = await issueForAssignment(tx, fx.studentId, assignment.id, "MANUAL");
      expect(second.kind).toBe("resume");
      if (second.kind === "resume") {
        expect(second.attemptId).toBe(first.attemptId);
        const resumed = await tx.attempt.findUniqueOrThrow({ where: { id: second.attemptId } });
        expect(resumed.moveIndex).toBe(2); // cursor preserved
        expect(resumed.status).toBe("PENDING");
      }
    });
  });
});

describe("issuance — FILTER exhaustion (gate #16)", () => {
  it("surfaces COMPLETE when no puzzle matches (progress < target)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // Filter range with no puzzles: [5000, 6000].
      const { assignment } = await buildFilter(tx, fx, { targetCount: 5, ratingMin: 5000, ratingMax: 6000 });

      const r = await issueForAssignment(tx, fx.studentId, assignment.id, "FILTER");
      expect(r.kind).toBe("complete"); // the page renders "no more puzzles match"
    });
  });

  it("surfaces COMPLETE for a MANUAL assignment once all items are solved", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const { assignment } = await buildManual(tx, fx, ["pz-1500-mate"]);
      // Mark the only item solved.
      await tx.assignmentItemProgress.updateMany({
        where: { assignmentId: assignment.id },
        data: { solved: true },
      });
      const r = await issueForAssignment(tx, fx.studentId, assignment.id, "MANUAL");
      expect(r.kind).toBe("complete");
    });
  });
});
