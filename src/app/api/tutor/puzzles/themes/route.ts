import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTutorActor } from "@/lib/auth-guards";

/**
 * GET /api/tutor/puzzles/themes
 * Distinct theme values across the puzzle library, for the FILTER editor's
 * theme checkbox list (spec §FILTER set editor: "checkbox list sourced from
 * SELECT DISTINCT unnest(themes) FROM Puzzle"). Read-only.
 */
export async function GET(_req: NextRequest) {
  const tutor = await getTutorActor();
  if (!tutor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db.$queryRaw<{ theme: string }[]>`
    SELECT DISTINCT t.theme
    FROM "Puzzle" p, unnest(p.themes) AS t(theme)
    WHERE t.theme <> ''
    ORDER BY t.theme
  `;
  return NextResponse.json({ themes: rows.map((r) => r.theme) });
}
