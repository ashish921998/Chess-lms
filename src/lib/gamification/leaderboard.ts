import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";

/** One ranked row of the class leaderboard. */
export type LeaderboardRow = {
  id: string;
  displayName: string;
  lifetimeCoins: number;
  solvedCount: number;
};

/**
 * Class leaderboard: every student of `tutorId`, ranked by lifetimeCoins DESC,
 * tie-broken by (solvedCount DESC, id ASC) — exactly the master spec. Display
 * names only; emails are never returned. The caller flags the session student's
 * own row client-side.
 *
 * Accepts a `PrismaTransaction` so it composes inside a rollback test tx, but it
 * only reads — pass the app `db` client in production.
 */
export async function classLeaderboard(
  tx: PrismaTransaction,
  tutorId: string
): Promise<LeaderboardRow[]> {
  const rows = await tx.$queryRaw<LeaderboardRow[]>`
    SELECT
      s.id,
      s."displayName",
      s."lifetimeCoins",
      COALESCE(
        SUM(CASE WHEN a.status = 'SOLVED' THEN 1 ELSE 0 END), 0
      ) AS "solvedCount"
    FROM "Student" s
    LEFT JOIN "Attempt" a ON a."studentId" = s.id
    WHERE s."tutorId" = ${tutorId}
    GROUP BY s.id, s."displayName", s."lifetimeCoins"
    ORDER BY s."lifetimeCoins" DESC, "solvedCount" DESC, s.id ASC
  `;
  return rows.map((r) => ({
    ...r,
    solvedCount: Number(r.solvedCount),
    lifetimeCoins: Number(r.lifetimeCoins),
  }));
}
