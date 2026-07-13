import { describe, it, expect } from "vitest";
import { withRollbackTx, seedFixture } from "./db-harness";
import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";
import {
  createSetTx,
  publishSetTx,
  assignVersionTx,
  addPuzzleItemTx,
  NotFoundError,
  ValidationError,
  type CreateSetInput,
} from "@/lib/tutor/sets";

/**
 * DB integration tests for the tutor puzzle-set + assignment logic
 * (gates #1, #2, #3, #13, #14). Drives the lib functions directly inside a
 * rollback tx; the route handlers are thin wrappers over these.
 */

const TUTOR_ACTOR = (tutorId: string) => ({ id: tutorId, userId: "ft-user" });

describe("publishSetTx — MANUAL materializes version items (gate #1)", () => {
  it("creates version items matching the draft, in order", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const tutor = TUTOR_ACTOR(fx.tutorId);
      const set = await createSetTx(tx, fx.tutorId, { title: "M", mode: "MANUAL" });
      await addPuzzleItemTx(tx, tutor, set.id, "pz-1000-backRank");
      await addPuzzleItemTx(tx, tutor, set.id, "pz-1100-fork");

      const version = await publishSetTx(tx, tutor, set.id);

      const items = await tx.puzzleSetVersionItem.findMany({
        where: { versionId: version.id },
        orderBy: { order: "asc" },
      });
      expect(items.map((i) => i.puzzleId)).toEqual(["pz-1000-backRank", "pz-1100-fork"]);
      expect(version.mode).toBe("MANUAL");
      expect(version.version).toBe(1);

      const refreshed = await tx.puzzleSet.findUniqueOrThrow({ where: { id: set.id } });
      expect(refreshed.isPublished).toBe(true);
    });
  });

  it("a re-publish creates version + 1 (immutable prior version untouched)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const tutor = TUTOR_ACTOR(fx.tutorId);
      const set = await createSetTx(tx, fx.tutorId, { title: "M", mode: "MANUAL" });
      await addPuzzleItemTx(tx, tutor, set.id, "pz-1000-backRank");
      const v1 = await publishSetTx(tx, tutor, set.id);

      // Edit + re-publish.
      await addPuzzleItemTx(tx, tutor, set.id, "pz-1100-fork");
      const v2 = await publishSetTx(tx, tutor, set.id);
      expect(v2.version).toBe(v1.version + 1);

      const v1Items = await tx.puzzleSetVersionItem.findMany({ where: { versionId: v1.id } });
      expect(v1Items).toHaveLength(1); // v1 unchanged
      const v2Items = await tx.puzzleSetVersionItem.findMany({
        where: { versionId: v2.id },
        orderBy: { order: "asc" },
      });
      expect(v2Items.map((i) => i.puzzleId)).toEqual(["pz-1000-backRank", "pz-1100-fork"]);
    });
  });
});

describe("publishSetTx — FILTER freezes criteria, no items (gate #2)", () => {
  it("stores frozen criteria and creates zero version items", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const tutor = TUTOR_ACTOR(fx.tutorId);
      const set = await createSetTx(tx, fx.tutorId, FILTER_INPUT);
      const version = await publishSetTx(tx, tutor, set.id);

      expect(version.mode).toBe("FILTER");
      expect(version.filterThemes).toEqual(["fork", "mate"]);
      expect(version.filterRatingMin).toBe(1000);
      expect(version.filterRatingMax).toBe(1600);
      expect(version.targetCount).toBe(20);

      const items = await tx.puzzleSetVersionItem.findMany({ where: { versionId: version.id } });
      expect(items).toHaveLength(0);
    });
  });
});

describe("assignVersionTx — materialization differs by mode (gate #3, #14)", () => {
  it("MANUAL assignment creates one AssignmentItemProgress per version item", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const tutor = TUTOR_ACTOR(fx.tutorId);
      const version = await publishManual(tx, fx.tutorId, ["pz-1000-backRank", "pz-1100-fork"]);

      const res = await assignVersionTx(tx, tutor, version.id, [fx.studentId], null);
      expect(res).toEqual({ created: 1, skipped: 0 });

      const items = await tx.assignmentItemProgress.findMany({
        where: { assignment: { versionId: version.id } },
        orderBy: { order: "asc" },
      });
      expect(items.map((i) => i.puzzleId)).toEqual(["pz-1000-backRank", "pz-1100-fork"]);
      expect(items.every((i) => !i.solved)).toBe(true);
    });
  });

  it("FILTER assignment creates no items; targetCount copied", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const tutor = TUTOR_ACTOR(fx.tutorId);
      const set = await createSetTx(tx, fx.tutorId, FILTER_INPUT);
      const version = await publishSetTx(tx, tutor, set.id);

      const res = await assignVersionTx(tx, tutor, version.id, [fx.studentId], null);
      expect(res).toEqual({ created: 1, skipped: 0 });

      const assignment = await tx.assignment.findFirstOrThrow({
        where: { versionId: version.id },
      });
      expect(assignment.targetCount).toBe(20);
      const items = await tx.assignmentItemProgress.count({
        where: { assignmentId: assignment.id },
      });
      expect(items).toBe(0);
    });
  });

  it("re-assigning the same (version, student) is a no-op (gate #14)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const tutor = TUTOR_ACTOR(fx.tutorId);
      const version = await publishManual(tx, fx.tutorId, ["pz-1500-mate"]);

      await assignVersionTx(tx, tutor, version.id, [fx.studentId], null);
      // Simulate some in-flight progress so we can assert it's preserved.
      const assignment = await tx.assignment.findFirstOrThrow({
        where: { versionId: version.id },
      });
      await tx.assignment.update({
        where: { id: assignment.id },
        data: { progress: 1 },
      });

      const res = await assignVersionTx(tx, tutor, version.id, [fx.studentId], null);
      expect(res).toEqual({ created: 0, skipped: 1 }); // skipped, not replaced

      const after = await tx.assignment.findFirstOrThrow({
        where: { versionId: version.id },
      });
      expect(after.progress).toBe(1); // in-flight progress intact
    });
  });
});

describe("authorization — cross-tutor access is a NotFoundError (gate #13)", () => {
  it("a tutor cannot publish another tutor's set", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const owner = TUTOR_ACTOR(fx.tutorId);
      const intruder = TUTOR_ACTOR(fx.tutor2Id);
      const version = await publishManual(tx, fx.tutorId, ["pz-1500-mate"]);

      await expect(publishSetTx(tx, intruder, version.setId)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it("a tutor cannot assign a version from another tutor's set", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const intruder = TUTOR_ACTOR(fx.tutor2Id);
      const version = await publishManual(tx, fx.tutorId, ["pz-1500-mate"]);

      await expect(
        assignVersionTx(tx, intruder, version.id, [fx.studentId], null)
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it("assigning a foreign (non-tutor-owned) student is a NotFoundError", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const intruder = TUTOR_ACTOR(fx.tutor2Id);
      const version = await publishManual(tx, fx.tutor2Id, ["pz-1500-mate"]);

      await expect(
        assignVersionTx(tx, intruder, version.id, [fx.studentId], null) // fx.studentId belongs to tutor1
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});

describe("createSetTx — mode invariants", () => {
  it("MANUAL rejects filter fields", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const bad: CreateSetInput = {
        title: "X",
        mode: "MANUAL",
        filterThemes: ["fork"],
      };
      await expect(createSetTx(tx, fx.tutorId, bad)).rejects.toBeInstanceOf(ValidationError);
    });
  });

  it("FILTER requires a positive targetCount", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const bad: CreateSetInput = { title: "X", mode: "FILTER", targetCount: 0 };
      await expect(createSetTx(tx, fx.tutorId, bad)).rejects.toBeInstanceOf(ValidationError);
    });
  });
});

// ── Helpers ──

const FILTER_INPUT: CreateSetInput = {
  title: "FILTER",
  mode: "FILTER",
  filterThemes: ["fork", "mate"],
  filterRatingMin: 1000,
  filterRatingMax: 1600,
  targetCount: 20,
};

async function publishManual(
  tx: PrismaTransaction,
  tutorId: string,
  puzzleIds: string[]
) {
  const tutor = TUTOR_ACTOR(tutorId);
  const set = await createSetTx(tx, tutorId, { title: "M", mode: "MANUAL" });
  for (const p of puzzleIds) await addPuzzleItemTx(tx, tutor, set.id, p);
  const version = await publishSetTx(tx, tutor, set.id);
  return { ...version, setId: set.id };
}
