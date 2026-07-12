/**
 * Documented Elo approximation. See spec §Rating Formula.
 *
 * - Expected score: E = 1 / (1 + 10^((puzzleRating - inAppRating)/400))
 * - Update: inAppRating += K * (actual - E), actual ∈ {1 win, 0 loss}
 * - K = ratingK (starts 40, steps down as rated attempts accrue)
 *
 * Rating deltas are computed from the student's CURRENT rating at finalize time,
 * not a stale read — the caller must hold a lock on the Student row.
 */

export function expectedScore(studentRating: number, puzzleRating: number): number {
  return 1 / (1 + Math.pow(10, (puzzleRating - studentRating) / 400));
}

export function eloDelta(
  studentRating: number,
  puzzleRating: number,
  actual: 0 | 1,
  k: number
): number {
  const e = expectedScore(studentRating, puzzleRating);
  return Math.round(k * (actual - e));
}

/**
 * Steps the K-factor down as the student accrues rated attempts (solves + fails).
 * 40 → 32 at 30, → 24 at 100, → 16 at 300.
 */
export function kFactorFor(ratedAttemptCount: number): number {
  if (ratedAttemptCount >= 300) return 16;
  if (ratedAttemptCount >= 100) return 24;
  if (ratedAttemptCount >= 30) return 32;
  return 40;
}
