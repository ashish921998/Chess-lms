import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";

export type ThemeAccuracy = {
  theme: string;
  solved: number;
  attempted: number;
  accuracy: number; // 0–100
};

/**
 * Per-theme solve accuracy for a student. Joins Attempt → Puzzle.themes and
 * groups by theme. Returns one row per attempted theme, sorted by attempted
 * desc. Solves/fails both count toward "attempted" (terminal attempts only).
 *
 * Accepts a PrismaTransaction so it composes in a rollback test tx.
 */
export async function themeAccuracy(
  tx: PrismaTransaction,
  studentId: string
): Promise<ThemeAccuracy[]> {
  // Unnest each puzzle's themes into one row per (attempt, theme), restricted
  // to terminal attempts, then group by theme.
  const rows = await tx.$queryRaw<
    { theme: string; solved: bigint; attempted: bigint }[]
  >`
    WITH terminal AS (
      SELECT a.status AS status, p.themes AS themes
      FROM "Attempt" a
      JOIN "Puzzle" p ON p.id = a."puzzleId"
      WHERE a."studentId" = ${studentId}
        AND a.status IN ('SOLVED', 'FAILED')
    ),
    unnested AS (
      SELECT t.status AS status, theme
      FROM terminal t, unnest(t.themes) AS theme
    )
    SELECT
      theme,
      COUNT(*) FILTER (WHERE status = 'SOLVED')::bigint AS solved,
      COUNT(*)::bigint AS attempted
    FROM unnested
    GROUP BY theme
    ORDER BY attempted DESC, theme ASC
  `;
  return rows.map((r) => ({
    theme: r.theme,
    solved: Number(r.solved),
    attempted: Number(r.attempted),
    accuracy: Number(r.attempted) === 0 ? 0 : Math.round((Number(r.solved) / Number(r.attempted)) * 100),
  }));
}
