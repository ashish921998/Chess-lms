import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { PrismaTransaction } from "./transaction-client";

/**
 * Puzzle selection: the auto-queue ladder, generalized to also serve FILTER
 * assignments.
 *
 * Two entry points share one ladder:
 *  - **Auto-queue** (`selectNextPuzzle(studentId)`): level-appropriate puzzle
 *    the student hasn't globally solved, via the `StudentPuzzle` anti-repeat.
 *  - **FILTER assignment** (`selectNextPuzzle(studentId, { filter, assignmentId })`):
 *    themes + rating range from the assignment's frozen version, anti-repeat
 *    SCOPED TO THE ASSIGNMENT (a puzzle solved elsewhere may still appear).
 *
 * The rating window for a FILTER assignment is the student's `inAppRating ±
 * margin` INTERSECTED with the version's `[filterRatingMin, filterRatingMax]`.
 * If that intersection is empty (the tutor's range doesn't overlap the
 * student's level), the final fallback drops the student window and uses only
 * the tutor's range — so the student is never stuck (spec §FILTER selection,
 * Issue 1 guard).
 */

const BASE_MARGIN = 250;
const WIDE_MARGIN = 400;
const WIDEST_MARGIN = 600;
/** Margin narrows once the student has a settled rating (50+ rated attempts). */
const RATED_COUNT_FOR_NARROW = 50;
const NARROW_MARGIN = 100;

export type SelectedPuzzle = {
  id: string;
  rating: number;
  themes: string[];
  startFen: string;
};

/** FILTER criteria, frozen on the version at publish time. */
export type PuzzleFilter = {
  themes: string[];
  ratingMin: number | null;
  ratingMax: number | null;
};

export type SelectOptions = {
  filter?: PuzzleFilter;
  /** When set, anti-repeat is scoped to SOLVED Attempts within this assignment. */
  assignmentId?: string;
};

/**
 * Compute the rating window: the student band `[rating - margin, rating + margin]`
 * intersected with the filter's `[ratingMin, ratingMax]`. Returns null when the
 * intersection is empty (caller falls back to the filter range alone, then to
 * exhaustion). Pure — unit-tested directly.
 *
 * `rating` is clamped to >= 0 on the low side.
 */
export function computeWindow(
  studentRating: number,
  margin: number,
  filter?: PuzzleFilter
): { lo: number; hi: number } | null {
  const bandLo = Math.max(0, studentRating - margin);
  const bandHi = studentRating + margin;

  if (!filter || (filter.ratingMin == null && filter.ratingMax == null)) {
    return { lo: bandLo, hi: bandHi };
  }

  const fLo = filter.ratingMin ?? -Infinity;
  const fHi = filter.ratingMax ?? Infinity;
  const lo = Math.max(bandLo, fLo);
  const hi = Math.min(bandHi, fHi);
  if (lo > hi) return null; // disjoint — caller drops the student window
  return { lo, hi };
}

/**
 * Select the next puzzle for a student. With no options this is the auto-queue
 * (global `StudentPuzzle` anti-repeat). With `{ filter, assignmentId }` it
 * serves a FILTER assignment (themes + intersected range, assignment-scoped
 * anti-repeat). Returns null when exhausted.
 *
 * Accepts an injected client so it composes inside a page's issuance
 * transaction or a test's rollback transaction.
 */
export async function selectNextPuzzle(
  studentId: string,
  opts?: SelectOptions,
  client: PrismaTransaction = db
): Promise<SelectedPuzzle | null> {
  const student = await client.student.findUniqueOrThrow({ where: { id: studentId } });
  const rating = student.inAppRating;

  const filter = opts?.filter;
  const assignmentId = opts?.assignmentId;
  const themes = filter?.themes ?? [];

  if (assignmentId || filter) {
    return runFilterLadder(client, studentId, rating, filter, assignmentId);
  }

  // ── Auto-queue ladder (unchanged behaviour) ──
  const ratedCount = await client.ratingEvent.count({ where: { studentId } });
  const marginNarrow = ratedCount >= RATED_COUNT_FOR_NARROW ? NARROW_MARGIN : BASE_MARGIN;

  for (const { margin, allowReplay } of [
    { margin: marginNarrow, allowReplay: false },
    { margin: WIDE_MARGIN, allowReplay: false },
    { margin: WIDEST_MARGIN, allowReplay: false },
    { margin: marginNarrow, allowReplay: true },
    { margin: WIDEST_MARGIN, allowReplay: true },
  ]) {
    const win = { lo: Math.max(0, rating - margin), hi: rating + margin };
    const p = await queryWindow(client, studentId, win, themes, undefined, allowReplay);
    if (p) return p;
  }
  return null; // queue complete
}

/**
 * FILTER selection ladder (spec §FILTER selection + Issue 1 guard). Anti-repeat
 * is assignment-scoped (a puzzle solved in auto-queue or another assignment may
 * still appear); the terminal state is "exhausted", distinct from auto-queue's
 * "queue complete".
 *
 * Ladder: intersected window at widening margins → if the intersection is empty
 * (or still no puzzle), query the filter range alone (least-recently-solved-in-
 * assignment tiebreak) → exhausted.
 */
async function runFilterLadder(
  client: PrismaTransaction,
  studentId: string,
  rating: number,
  filter: PuzzleFilter | undefined,
  assignmentId: string | undefined
): Promise<SelectedPuzzle | null> {
  const themes = filter?.themes ?? [];

  // 1-2. Intersected window at widening margins (anti-repeat).
  for (const margin of [BASE_MARGIN, WIDE_MARGIN, WIDEST_MARGIN]) {
    const win = computeWindow(rating, margin, filter);
    if (!win) continue; // disjoint at this margin — try wider / fall through
    const p = await queryWindow(client, studentId, win, themes, assignmentId, false);
    if (p) return p;
  }

  // 3. Intersection empty (or still no puzzle): drop the student window and
  //    query the filter range alone, least-recently-solved-in-assignment as
  //    tiebreak. Issue 1 guard — prevents getting stuck when the tutor's range
  //    is disjoint from the student's level.
  if (filter && (filter.ratingMin != null || filter.ratingMax != null)) {
    const win = {
      lo: Math.max(0, filter.ratingMin ?? 0),
      hi: filter.ratingMax ?? Number.MAX_SAFE_INTEGER,
    };
    const p = await queryWindow(client, studentId, win, themes, assignmentId, true);
    if (p) return p;
  }

  return null; // assignment exhausted (no puzzle matches the tutor's range)
}

/**
 * Query for a puzzle in the given window.
 *
 * - `themes` (FILTER only): when non-empty, require `themes && $themes` overlap.
 *   An empty array means "any theme" and OMITS the clause entirely (Postgres
 *   `arr && '{}'` is false, so we branch in TS rather than rely on the literal).
 * - Anti-repeat: when `assignmentId` is set, exclude puzzles SOLVED within THAT
 *   assignment (assignment-scoped). Otherwise use the global `StudentPuzzle` set.
 * - `allowReplay`: remove the anti-repeat constraint and ORDER BY
 *   least-recently-seen (auto-queue: `StudentPuzzle.lastSeenAt`; FILTER: most
 *   recent SOLVED Attempt for this assignment).
 */
async function queryWindow(
  client: PrismaTransaction,
  studentId: string,
  win: { lo: number; hi: number },
  themes: string[],
  assignmentId: string | undefined,
  allowReplay: boolean
): Promise<SelectedPuzzle | null> {
  const { lo, hi } = win;
  // Optional theme-overlap clause. Built once so it slots into either branch.
  const themeClause = themes.length > 0 ? Prisma.sql`AND p.themes && ${themes}::text[]` : Prisma.empty;

  if (assignmentId) {
    // Assignment-scoped anti-repeat against SOLVED Attempts in this assignment.
    if (allowReplay) {
      const rows = await client.$queryRaw<SelectedPuzzle[]>`
        SELECT p.id, p.rating, p.themes, p."startFen"
        FROM "Puzzle" p
        LEFT JOIN LATERAL (
          SELECT MAX(a."createdAt") AS "lastSolvedAt"
          FROM "Attempt" a
          WHERE a."puzzleId" = p.id
            AND a."assignmentId" = ${assignmentId}
            AND a."studentId" = ${studentId}
            AND a.status = 'SOLVED'
        ) ls ON true
        WHERE p.rating BETWEEN ${lo} AND ${hi}
          ${themeClause}
        ORDER BY ls."lastSolvedAt" ASC NULLS FIRST, p.popularity DESC
        LIMIT 1
      `;
      return rows[0] ?? null;
    }

    const rows = await client.$queryRaw<SelectedPuzzle[]>`
      SELECT p.id, p.rating, p.themes, p."startFen"
      FROM "Puzzle" p
      WHERE p.rating BETWEEN ${lo} AND ${hi}
        ${themeClause}
        AND NOT EXISTS (
          SELECT 1 FROM "Attempt" a
          WHERE a."puzzleId" = p.id
            AND a."assignmentId" = ${assignmentId}
            AND a."studentId" = ${studentId}
            AND a.status = 'SOLVED'
        )
      ORDER BY p.popularity DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  // Auto-queue: global StudentPuzzle anti-repeat.
  if (allowReplay) {
    const rows = await client.$queryRaw<SelectedPuzzle[]>`
      SELECT p.id, p.rating, p.themes, p."startFen"
      FROM "Puzzle" p
      LEFT JOIN "StudentPuzzle" sp ON sp."puzzleId" = p.id AND sp."studentId" = ${studentId}
      WHERE p.rating BETWEEN ${lo} AND ${hi}
      ORDER BY sp."lastSeenAt" ASC NULLS FIRST, p.popularity DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  const rows = await client.$queryRaw<SelectedPuzzle[]>`
    SELECT p.id, p.rating, p.themes, p."startFen"
    FROM "Puzzle" p
    WHERE p.rating BETWEEN ${lo} AND ${hi}
      AND NOT EXISTS (
        SELECT 1 FROM "StudentPuzzle" sp
        WHERE sp."puzzleId" = p.id AND sp."studentId" = ${studentId}
      )
    ORDER BY p.popularity DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}
