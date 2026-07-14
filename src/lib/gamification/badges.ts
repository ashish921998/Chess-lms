import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";

/**
 * Badge keys. Stored on StudentBadge.badgeKey. Theme-master badges are
 * `theme_master_<theme>` — one per theme at 20 solves. Everything else is fixed.
 */
export const THEME_MASTER_PREFIX = "theme_master_";

/** Human labels for fixed badges (theme_master_* is rendered from its theme). */
export const BADGE_LABELS: Record<string, string> = {
  first_solve: "First Solve",
  streak_7: "7-Day Streak",
  streak_30: "30-Day Streak",
  centurion: "Centurion",
  sharpshooter: "Sharpshooter",
  comeback: "Comeback",
};

/** The attempt + puzzle fields badge evaluation needs at SOLVED finalize. */
export type BadgeAttempt = {
  id: string;
  studentId: string;
  puzzleId: string;
  themes: string[];
  createdAt: Date;
};

/**
 * Evaluate every badge at the end of a SOLVED finalize. All upserts are
 * idempotent (`ON CONFLICT ([studentId, badgeKey]) DO NOTHING`) so re-finalize
 * never duplicates. Only the *current puzzle's* themes are evaluated for
 * theme_master — the badge naturally fires when a solve pushes a theme to 20.
 * (spec §1d.)
 *
 * `ctx.streak` is the POST-SOLVE streak, computed by the finalize coordinator
 * (step 6) and passed in via a typed context so this dependency on call order
 * is explicit — this must be the streak *after* the solve's DailyProgress
 * upsert, not before.
 */
export async function evaluateBadgesTx(
  tx: PrismaTransaction,
  attempt: BadgeAttempt,
  ctx: { streak: number }
): Promise<string[]> {
  const awarded: string[] = [];
  const { studentId } = attempt;
  const { streak } = ctx;

  // first_solve — this is the student's first SOLVED attempt.
  const priorSolved = await tx.attempt.count({
    where: { studentId, status: "SOLVED", id: { not: attempt.id } },
  });
  if (priorSolved === 0) {
    await award(tx, studentId, "first_solve", awarded);
  }

  // streak_7 / streak_30 — reuse the streak already computed.
  if (streak >= 7) await award(tx, studentId, "streak_7", awarded);
  if (streak >= 30) await award(tx, studentId, "streak_30", awarded);

  // centurion — lifetime SOLVED count ≥ 100.
  const lifetimeSolved = priorSolved + 1; // this solve is now counted
  if (lifetimeSolved >= 100) {
    await award(tx, studentId, "centurion", awarded);
  }

  // sharpshooter — last 10 terminal attempts (SOLVED/FAILED) are all SOLVED,
  // and there are at least 10. (Does not fire before 10 terminal attempts.)
  const lastTerminal = await tx.$queryRaw<{ status: string }[]>`
    SELECT status FROM "Attempt"
    WHERE "studentId" = ${studentId} AND status IN ('SOLVED', 'FAILED')
    ORDER BY "createdAt" DESC
    LIMIT 10
  `;
  if (lastTerminal.length === 10 && lastTerminal.every((r) => r.status === "SOLVED")) {
    await award(tx, studentId, "sharpshooter", awarded);
  }

  // comeback — the 3 attempts immediately before this one are all FAILED.
  const preceding = await tx.$queryRaw<{ status: string }[]>`
    SELECT status FROM "Attempt"
    WHERE "studentId" = ${studentId} AND "createdAt" < ${attempt.createdAt}
    ORDER BY "createdAt" DESC
    LIMIT 3
  `;
  if (preceding.length === 3 && preceding.every((r) => r.status === "FAILED")) {
    await award(tx, studentId, "comeback", awarded);
  }

  // theme_master_<theme> — for each theme in this puzzle, SOLVED count on
  // puzzles containing that theme ≥ 20.
  for (const theme of attempt.themes) {
    const themeRows = await tx.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM "Attempt" a
      JOIN "Puzzle" p ON p.id = a."puzzleId"
      WHERE a."studentId" = ${studentId}
        AND a.status = 'SOLVED'
        AND ${theme} = ANY(p.themes)
    `;
    const count = Number(themeRows[0]?.count ?? 0);
    if (count >= 20) {
      await award(tx, studentId, `${THEME_MASTER_PREFIX}${theme}`, awarded);
    }
  }

  return awarded;
}

/**
 * Idempotent upsert. Inserts a StudentBadge only if it doesn't already exist;
 * pushes the key to `awarded` when newly created (so the caller can surface it).
 */
async function award(
  tx: PrismaTransaction,
  studentId: string,
  badgeKey: string,
  awarded: string[]
): Promise<void> {
  const result = await tx.$queryRaw<{ badgeKey: string }[]>`
    INSERT INTO "StudentBadge" (id, "studentId", "badgeKey", "awardedAt")
    VALUES (gen_random_uuid(), ${studentId}, ${badgeKey}, NOW())
    ON CONFLICT ("studentId", "badgeKey") DO NOTHING RETURNING "badgeKey"
  `;
  if (result.length > 0) {
    awarded.push(badgeKey);
  }
}

/** Human label for a badge key, including theme_master_<theme>. */
export function badgeLabel(badgeKey: string): string {
  if (badgeKey.startsWith(THEME_MASTER_PREFIX)) {
    const theme = badgeKey.slice(THEME_MASTER_PREFIX.length);
    return `Theme Master · ${theme}`;
  }
  return BADGE_LABELS[badgeKey] ?? badgeKey;
}
