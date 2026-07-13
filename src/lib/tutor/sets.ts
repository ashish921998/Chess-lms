import { SetMode } from "@prisma/client";
import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";
import type { ActorTutor } from "@/lib/auth-guards";

/**
 * Tutor puzzle-set + assignment transactional logic. Each function takes an
 * injected `tx` so it composes inside a route handler's transaction (and a
 * test's rollback tx). All access is scoped by `tutorId`: a cross-tutor setId
 * resolves to "not found" (404 at the route layer), never an existence leak.
 *
 * Mode invariants (enforced on create and update):
 *   - MANUAL sets reject filter fields (themes/ratingMin/ratingMax/targetCount).
 *   - FILTER sets accept filter fields and never carry items/title-only.
 * `mode` is immutable after create.
 */

export type CreateSetInput = {
  title: string;
  description?: string;
  mode: SetMode;
  filterThemes?: string[];
  filterRatingMin?: number | null;
  filterRatingMax?: number | null;
  targetCount?: number | null;
};

export type UpdateSetInput = {
  title?: string;
  description?: string | null;
  // FILTER-only mutable fields:
  filterThemes?: string[];
  filterRatingMin?: number | null;
  filterRatingMax?: number | null;
  targetCount?: number | null;
};

/** Create a set. Throws on a mode/invariant violation (route maps to 400). */
export async function createSetTx(tx: PrismaTransaction, tutorId: string, input: CreateSetInput) {
  assertModeFields(input.mode, input);

  return tx.puzzleSet.create({
    data: {
      tutorId,
      title: input.title,
      description: input.description,
      mode: input.mode,
      filterThemes: input.mode === "FILTER" ? (input.filterThemes ?? []) : [],
      filterRatingMin: input.mode === "FILTER" ? input.filterRatingMin ?? null : null,
      filterRatingMax: input.mode === "FILTER" ? input.filterRatingMax ?? null : null,
      targetCount: input.mode === "FILTER" ? input.targetCount ?? null : null,
    },
  });
}

/**
 * Update a set's draft. Scoped by tutor; throws NotFoundError if the set isn't
 * owned by this tutor. Mode-aware: FILTER fields are only applied on FILTER sets.
 */
export async function updateSetTx(
  tx: PrismaTransaction,
  tutor: ActorTutor,
  setId: string,
  input: UpdateSetInput
) {
  const set = await getOwnedSetOrThrow(tx, tutor, setId);
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (set.mode === "FILTER") {
    if (input.filterThemes !== undefined) data.filterThemes = input.filterThemes;
    if (input.filterRatingMin !== undefined) data.filterRatingMin = input.filterRatingMin;
    if (input.filterRatingMax !== undefined) data.filterRatingMax = input.filterRatingMax;
    if (input.targetCount !== undefined) data.targetCount = input.targetCount;
  }
  return tx.puzzleSet.update({ where: { id: setId }, data });
}

/** Delete a set (cascade removes its items/versions). Scoped by tutor. */
export async function deleteSetTx(tx: PrismaTransaction, tutor: ActorTutor, setId: string) {
  await getOwnedSetOrThrow(tx, tutor, setId);
  await tx.puzzleSet.delete({ where: { id: setId } });
}

/**
 * Add a puzzle to a MANUAL set's draft. `order` = max(existing order) + 1.
 * Rejects (NotFoundError/400) if the set isn't MANUAL or isn't owned.
 */
export async function addPuzzleItemTx(
  tx: PrismaTransaction,
  tutor: ActorTutor,
  setId: string,
  puzzleId: string
) {
  const set = await getOwnedSetOrThrow(tx, tutor, setId);
  if (set.mode !== "MANUAL") {
    throw new ValidationError("FILTER sets do not hold puzzle items");
  }
  // Verify the puzzle exists (referential integrity before insert).
  const puzzle = await tx.puzzle.findUnique({ where: { id: puzzleId } });
  if (!puzzle) throw new NotFoundError("puzzle");

  const maxOrder = await tx.puzzleSetItem.aggregate({
    where: { setId },
    _max: { order: true },
  });
  const order = (maxOrder._max.order ?? -1) + 1;
  return tx.puzzleSetItem.create({ data: { setId, puzzleId, order } });
}

/** Remove a puzzle item from a MANUAL set's draft by puzzleId. Scoped. */
export async function removePuzzleItemTx(
  tx: PrismaTransaction,
  tutor: ActorTutor,
  setId: string,
  puzzleId: string
) {
  const set = await getOwnedSetOrThrow(tx, tutor, setId);
  if (set.mode !== "MANUAL") {
    throw new ValidationError("FILTER sets do not hold puzzle items");
  }
  await tx.puzzleSetItem.deleteMany({ where: { setId, puzzleId } });
}

/**
 * Reorder a MANUAL set's items to match the given puzzleId sequence (0-indexed).
 * Two-phase write avoids the `@@unique([setId, order])` transient-collision: first
 * bump every order by a large offset, then compact to the final 0..n-1 values.
 * Validates the provided puzzleIds exactly match the set's current items.
 */
export async function reorderItemsTx(
  tx: PrismaTransaction,
  tutor: ActorTutor,
  setId: string,
  orderedPuzzleIds: string[]
) {
  const set = await getOwnedSetOrThrow(tx, tutor, setId);
  if (set.mode !== "MANUAL") {
    throw new ValidationError("FILTER sets do not hold puzzle items");
  }

  const items = await tx.puzzleSetItem.findMany({ where: { setId } });
  const currentIds = new Set(items.map((i) => i.puzzleId));
  const orderedIds = new Set(orderedPuzzleIds);
  if (currentIds.size !== orderedIds.size || [...currentIds].some((id) => !orderedIds.has(id))) {
    throw new ValidationError("ordered puzzleIds must match the set's current items");
  }

  const OFFSET = 1_000_000;
  const byPuzzleId = new Map(items.map((i) => [i.puzzleId, i.id]));
  // Phase 1: shift to offset+index so no row collides with a not-yet-written order.
  for (let i = 0; i < orderedPuzzleIds.length; i++) {
    await tx.puzzleSetItem.update({
      where: { id: byPuzzleId.get(orderedPuzzleIds[i])! },
      data: { order: OFFSET + i },
    });
  }
  // Phase 2: compact to 0..n-1.
  for (let i = 0; i < orderedPuzzleIds.length; i++) {
    await tx.puzzleSetItem.update({
      where: { id: byPuzzleId.get(orderedPuzzleIds[i])! },
      data: { order: i },
    });
  }
}

/**
 * Search the puzzle library for MANUAL add-by-search. Returns puzzles matching
 * the rating range and/or theme overlap (themes empty ⇒ any), ordered by
 * popularity, capped at `limit`. Read-only.
 */
export async function searchPuzzlesTx(
  tx: PrismaTransaction,
  opts: { ratingMin?: number | null; ratingMax?: number | null; themes?: string[]; limit?: number }
) {
  const { Prisma } = await import("@prisma/client");
  const ratingMin = opts.ratingMin ?? null;
  const ratingMax = opts.ratingMax ?? null;
  const themes = opts.themes?.filter((t) => t.length > 0) ?? [];
  const limit = Math.min(opts.limit ?? 50, 200);
  const themeClause = themes.length > 0 ? Prisma.sql`AND p.themes && ${themes}::text[]` : Prisma.empty;

  const rows = await tx.$queryRaw<
    { id: string; rating: number; themes: string[]; popularity: number }[]
  >`
    SELECT p.id, p.rating, p.themes, p.popularity
    FROM "Puzzle" p
    WHERE (${ratingMin}::int IS NULL OR p.rating >= ${ratingMin}::int)
      AND (${ratingMax}::int IS NULL OR p.rating <= ${ratingMax}::int)
      ${themeClause}
    ORDER BY p.popularity DESC
    LIMIT ${limit}
  `;
  return rows;
}

/**
 * Publish: materialize an immutable `PuzzleSetVersion` from the current draft.
 *   - MANUAL → copy current `PuzzleSetItem`s to `PuzzleSetVersionItem`s, in order.
 *   - FILTER → freeze criteria onto the version; no items.
 * `version` is monotonic per set (`max(version) + 1`). Sets `isPublished`.
 *
 * A MANUAL set with zero items or a FILTER set with no targetCount is rejected.
 */
export async function publishSetTx(
  tx: PrismaTransaction,
  tutor: ActorTutor,
  setId: string
) {
  const set = await getOwnedSetOrThrow(tx, tutor, setId);

  if (set.mode === "FILTER" && (set.targetCount == null || set.targetCount <= 0)) {
    throw new ValidationError("FILTER sets need a positive targetCount to publish");
  }

  const maxVersion = await tx.puzzleSetVersion.aggregate({
    where: { setId },
    _max: { version: true },
  });
  const versionNumber = (maxVersion._max.version ?? 0) + 1;

  const version = await tx.puzzleSetVersion.create({
    data: {
      setId,
      version: versionNumber,
      mode: set.mode,
      filterThemes: set.mode === "FILTER" ? set.filterThemes : [],
      filterRatingMin: set.mode === "FILTER" ? set.filterRatingMin : null,
      filterRatingMax: set.mode === "FILTER" ? set.filterRatingMax : null,
      targetCount: set.mode === "FILTER" ? set.targetCount : null,
    },
  });

  if (set.mode === "MANUAL") {
    const items = await tx.puzzleSetItem.findMany({
      where: { setId },
      orderBy: { order: "asc" },
    });
    if (items.length === 0) {
      throw new ValidationError("cannot publish a MANUAL set with no items");
    }
    await tx.puzzleSetVersionItem.createMany({
      data: items.map((it) => ({
        versionId: version.id,
        puzzleId: it.puzzleId,
        order: it.order,
      })),
    });
  }

  await tx.puzzleSet.update({ where: { id: setId }, data: { isPublished: true } });
  return version;
}

/**
 * Assign a version to one or more students. Idempotent per (version, student)
 * via the `@@unique([versionId, studentId])` constraint: existing assignments
 * are skipped (in-flight progress preserved, never replaced).
 *
 *   - MANUAL → materialize `AssignmentItemProgress` (one per version item).
 *   - FILTER → no items; `targetCount` copied onto the assignment.
 *
 * Returns counts: `{ created, skipped }`.
 */
export async function assignVersionTx(
  tx: PrismaTransaction,
  tutor: ActorTutor,
  versionId: string,
  studentIds: string[],
  dueDate: Date | null
): Promise<{ created: number; skipped: number }> {
  // Scope: the version must belong to one of this tutor's sets.
  const version = await tx.puzzleSetVersion.findUnique({
    where: { id: versionId },
    include: { set: { select: { tutorId: true } } },
  });
  if (!version || version.set.tutorId !== tutor.id) throw new NotFoundError("version");

  const versionItems =
    version.mode === "MANUAL"
      ? await tx.puzzleSetVersionItem.findMany({
          where: { versionId },
          orderBy: { order: "asc" },
        })
      : [];

  let created = 0;
  let skipped = 0;
  for (const studentId of studentIds) {
    // Verify the student belongs to this tutor (404 otherwise).
    const student = await tx.student.findUnique({ where: { id: studentId } });
    if (!student || student.tutorId !== tutor.id) throw new NotFoundError("student");

    // Skip if an assignment for (version, student) already exists — idempotent,
    // keeps in-flight progress intact (spec §Assign).
    const existing = await tx.assignment.findUnique({
      where: { versionId_studentId: { versionId, studentId } },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const assignment = await tx.assignment.create({
      data: {
        versionId,
        studentId,
        dueDate,
        targetCount: version.mode === "FILTER" ? version.targetCount : null,
      },
    });

    if (version.mode === "MANUAL") {
      await tx.assignmentItemProgress.createMany({
        data: versionItems.map((vi) => ({
          assignmentId: assignment.id,
          puzzleId: vi.puzzleId,
          order: vi.order,
        })),
      });
    }
    created++;
  }
  return { created, skipped };
}

// ── Helpers ──

/** Load a set scoped by tutor; throw NotFoundError (→ 404) if missing/foreign. */
export async function getOwnedSetOrThrow(tx: PrismaTransaction, tutor: ActorTutor, setId: string) {
  const set = await tx.puzzleSet.findUnique({ where: { id: setId } });
  if (!set || set.tutorId !== tutor.id) throw new NotFoundError("set");
  return set;
}

/** Reject mode/invariant violations on create input. */
function assertModeFields(mode: SetMode, input: CreateSetInput) {
  const hasFilterFields =
    (input.filterThemes && input.filterThemes.length > 0) ||
    input.filterRatingMin != null ||
    input.filterRatingMax != null ||
    input.targetCount != null;
  if (mode === "MANUAL" && hasFilterFields) {
    throw new ValidationError("MANUAL sets cannot have filter fields");
  }
  if (mode === "FILTER" && (input.targetCount == null || input.targetCount <= 0)) {
    throw new ValidationError("FILTER sets need a positive targetCount");
  }
}

/** Thrown by scoped accessors when the row is missing or foreign → route 404. */
export class NotFoundError extends Error {
  constructor(public readonly what: string) {
    super(`not found: ${what}`);
    this.name = "NotFoundError";
  }
}

/** Thrown on invariant/validation violations → route 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Map a thrown tutor-logic error to a `{status, body}` pair for route handlers
 * to return as a NextResponse. Returns null when `e` is unknown (caller should
 * rethrow). Centralizes the NotFoundError → 404 / ValidationError → 400 mapping
 * so all tutor handlers share it.
 */
export function tutorErrorResponse(
  e: unknown
): { status: number; body: { error: string } } | null {
  if (e instanceof NotFoundError) return { status: 404, body: { error: "not_found" } };
  if (e instanceof ValidationError) return { status: 400, body: { error: e.message } };
  return null;
}
