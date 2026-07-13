import { describe, it, expect } from "vitest";
import { withRollbackTx, seedFixture } from "./db-harness";
import { selectNextPuzzle, computeWindow } from "@/lib/puzzles/selection";

/**
 * DB integration tests for the generalized selection ladder (gates #5, #6, #10).
 * Auto-queue is exercised as a regression; FILTER assignment-scoped anti-repeat
 * and the disjoint-range fallback are the new behaviour.
 */
describe("selectNextPuzzle — auto-queue (regression)", () => {
  it("picks an unseen puzzle in the student's rating band", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // Student rated 1500; fixture puzzles span 1000-1900. Band ±250 = [1250,1750].
      const p = await selectNextPuzzle(fx.studentId, undefined, tx);
      expect(p).not.toBeNull();
      if (p) {
        expect(p.rating).toBeGreaterThanOrEqual(1250);
        expect(p.rating).toBeLessThanOrEqual(1750);
      }
    });
  });

  it("returns null only when the queue is genuinely exhausted", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // Mark every fixture puzzle seen globally.
      for (const pz of fx.puzzles) {
        await tx.studentPuzzle.create({
          data: { studentId: fx.studentId, puzzleId: pz.id },
        });
      }
      // Auto-queue still returns one via the replay (least-recently-seen) path.
      const p = await selectNextPuzzle(fx.studentId, undefined, tx);
      expect(p).not.toBeNull();
    });
  });
});

describe("selectNextPuzzle — FILTER assignment (gate #5, #6)", () => {
  it("serves a puzzle matching themes within the student window (gate #5)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // Make an assignment row so anti-repeat is scoped.
      const set = await tx.puzzleSet.create({
        data: { tutorId: fx.tutorId, title: "T", mode: "FILTER" },
      });
      const version = await tx.puzzleSetVersion.create({
        data: {
          setId: set.id,
          version: 1,
          mode: "FILTER",
          filterThemes: ["fork"],
          filterRatingMin: 1000,
          filterRatingMax: 1600,
          targetCount: 5,
        },
      });
      const assignment = await tx.assignment.create({
        data: { versionId: version.id, studentId: fx.studentId, targetCount: 5 },
      });

      const p = await selectNextPuzzle(
        fx.studentId,
        { filter: { themes: ["fork"], ratingMin: 1000, ratingMax: 1600 }, assignmentId: assignment.id },
        tx
      );
      expect(p).not.toBeNull();
      if (p) {
        expect(p.themes).toContain("fork");
        expect(p.rating).toBeGreaterThanOrEqual(1000);
        expect(p.rating).toBeLessThanOrEqual(1600);
      }
    });
  });

  it("anti-repeat is assignment-scoped: a puzzle solved globally still appears (gate #6)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // Student has globally SOLVED pz-1100-fork (it's in StudentPuzzle).
      const globallySolved = fx.puzzles.find((p) => p.id === "pz-1100-fork")!;
      await tx.studentPuzzle.create({
        data: { studentId: fx.studentId, puzzleId: globallySolved.id },
      });

      const set = await tx.puzzleSet.create({
        data: { tutorId: fx.tutorId, title: "T", mode: "FILTER" },
      });
      const version = await tx.puzzleSetVersion.create({
        data: {
          setId: set.id,
          version: 1,
          mode: "FILTER",
          filterThemes: ["fork"],
          filterRatingMin: 1000,
          filterRatingMax: 1200,
          targetCount: 5,
        },
      });
      const assignment = await tx.assignment.create({
        data: { versionId: version.id, studentId: fx.studentId, targetCount: 5 },
      });

      const p = await selectNextPuzzle(
        fx.studentId,
        { filter: { themes: ["fork"], ratingMin: 1000, ratingMax: 1200 }, assignmentId: assignment.id },
        tx
      );
      // The only fork in [1000,1200] is pz-1100-fork, which is globally solved —
      // assignment-scoped anti-repeat must STILL return it.
      expect(p?.id).toBe("pz-1100-fork");
    });
  });
});

describe("computeWindow — intersection math (gate #10)", () => {
  it("intersects the student band with the filter range", () => {
    const w = computeWindow(1500, 250, { themes: [], ratingMin: 1400, ratingMax: 2000 });
    expect(w).toEqual({ lo: 1400, hi: 1750 });
  });

  it("returns null when the filter range is disjoint from the student band", () => {
    // Student 2000 ± 250 = [1750, 2250]; filter [800, 1000] → disjoint.
    const w = computeWindow(2000, 250, { themes: [], ratingMin: 800, ratingMax: 1000 });
    expect(w).toBeNull();
  });

  it("treats an absent filter as the student band alone", () => {
    expect(computeWindow(1500, 250, undefined)).toEqual({ lo: 1250, hi: 1750 });
    expect(computeWindow(1500, 250, { themes: [], ratingMin: null, ratingMax: null })).toEqual({
      lo: 1250,
      hi: 1750,
    });
  });
});

describe("selectNextPuzzle — FILTER disjoint range fallback (gate #10)", () => {
  it("serves from the filter range when it's disjoint from the student window", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // Bump the student out of the filter band so the intersection is empty.
      await tx.student.update({
        where: { id: fx.studentId },
        data: { inAppRating: 2000 }, // band [1750,2250] vs filter [1000,1200] → disjoint
      });

      const set = await tx.puzzleSet.create({
        data: { tutorId: fx.tutorId, title: "T", mode: "FILTER" },
      });
      const version = await tx.puzzleSetVersion.create({
        data: {
          setId: set.id,
          version: 1,
          mode: "FILTER",
          filterThemes: [],
          filterRatingMin: 1000,
          filterRatingMax: 1200,
          targetCount: 5,
        },
      });
      const assignment = await tx.assignment.create({
        data: { versionId: version.id, studentId: fx.studentId, targetCount: 5 },
      });

      const p = await selectNextPuzzle(
        fx.studentId,
        { filter: { themes: [], ratingMin: 1000, ratingMax: 1200 }, assignmentId: assignment.id },
        tx
      );
      // Must not get stuck — a puzzle in the filter range [1000,1200] is served.
      expect(p).not.toBeNull();
      if (p) {
        expect(p.rating).toBeGreaterThanOrEqual(1000);
        expect(p.rating).toBeLessThanOrEqual(1200);
      }
    });
  });

  it("returns null only when no puzzle matches the filter range at all", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // Filter range with no puzzles: [5000, 6000].
      const set = await tx.puzzleSet.create({
        data: { tutorId: fx.tutorId, title: "T", mode: "FILTER" },
      });
      const version = await tx.puzzleSetVersion.create({
        data: {
          setId: set.id,
          version: 1,
          mode: "FILTER",
          filterThemes: [],
          filterRatingMin: 5000,
          filterRatingMax: 6000,
          targetCount: 5,
        },
      });
      const assignment = await tx.assignment.create({
        data: { versionId: version.id, studentId: fx.studentId, targetCount: 5 },
      });

      const p = await selectNextPuzzle(
        fx.studentId,
        { filter: { themes: [], ratingMin: 5000, ratingMax: 6000 }, assignmentId: assignment.id },
        tx
      );
      expect(p).toBeNull(); // exhausted
    });
  });
});
