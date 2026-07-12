import { db } from "@/lib/db";

/**
 * Auto-queue puzzle selection. Picks a level-appropriate puzzle the student
 * hasn't solved yet, using the rating window + anti-repeat + fallback ladder
 * from the spec §Puzzle Selection Logic.
 *
 * Window: [inAppRating - margin, inAppRating + margin]
 *   - margin starts at ±250 (wide for new students)
 *   - narrows as rating events accrue (down to ±100 at 50+ rated attempts)
 *
 * Fallback ladder (if the window is exhausted):
 *   1. Widen the window in steps (±250 → ±400 → ±600)
 *   2. Allow least-recently-seen puzzles (reuse StudentPuzzle.lastSeenAt)
 *   3. Return null (queue complete — surface to student)
 */

const BASE_MARGIN = 250;
const WIDE_MARGIN = 400;
const WIDEST_MARGIN = 600;

export type SelectedPuzzle = {
  id: string;
  rating: number;
  themes: string[];
  startFen: string;
};

/**
 * Select the next puzzle for a student. Returns null if the queue is exhausted
 * (all puzzles seen, even after widening — rare with 150K+ puzzles).
 */
export async function selectNextPuzzle(studentId: string): Promise<SelectedPuzzle | null> {
  const student = await db.student.findUniqueOrThrow({ where: { id: studentId } });
  const rating = student.inAppRating;

  // Count rated attempts to determine margin narrowing.
  const ratedCount = await db.ratingEvent.count({ where: { studentId } });
  const marginNarrow = ratedCount >= 50 ? 100 : BASE_MARGIN;

  // 1. Try the primary window (not seen, in rating band, by popularity).
  let puzzle = await queryWindow(studentId, rating, marginNarrow, false);
  if (puzzle) return puzzle;

  // 2. Widen to ±400.
  puzzle = await queryWindow(studentId, rating, WIDE_MARGIN, false);
  if (puzzle) return puzzle;

  // 3. Widen to ±600.
  puzzle = await queryWindow(studentId, rating, WIDEST_MARGIN, false);
  if (puzzle) return puzzle;

  // 4. Allow least-recently-seen puzzles (re-solve path — replays).
  puzzle = await queryWindow(studentId, rating, marginNarrow, true);
  if (puzzle) return puzzle;

  // 5. Widest + replays.
  puzzle = await queryWindow(studentId, rating, WIDEST_MARGIN, true);
  if (puzzle) return puzzle;

  return null; // queue complete
}

/**
 * Query for a puzzle in the given window. Uses a correlated NOT EXISTS
 * anti-join (not a NOT IN list) for scalability. When allowReplay is true,
 * the anti-join is removed and we ORDER BY least-recently-seen.
 */
async function queryWindow(
  studentId: string,
  studentRating: number,
  margin: number,
  allowReplay: boolean
): Promise<SelectedPuzzle | null> {
  const lo = Math.max(0, studentRating - margin);
  const hi = studentRating + margin;

  if (allowReplay) {
    // Allow puzzles the student has seen — pick least-recently-seen.
    const rows = await db.$queryRaw<SelectedPuzzle[]>`
      SELECT p.id, p.rating, p.themes, p."startFen"
      FROM "Puzzle" p
      LEFT JOIN "StudentPuzzle" sp ON sp."puzzleId" = p.id AND sp."studentId" = ${studentId}
      WHERE p.rating BETWEEN ${lo} AND ${hi}
      ORDER BY sp."lastSeenAt" ASC NULLS FIRST, p.popularity DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  // Primary path: NOT EXISTS anti-join (scales — no loading attempted IDs).
  const rows = await db.$queryRaw<SelectedPuzzle[]>`
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
