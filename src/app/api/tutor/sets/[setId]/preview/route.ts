import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getTutorActor } from "@/lib/auth-guards";
import { getOwnedSetOrThrow } from "@/lib/tutor/sets";

/**
 * POST /api/tutor/sets/[setId]/preview — count puzzles matching the given
 * FILTER criteria. Read-only; used by the editor's "Preview count" button so the
 * tutor sees how many puzzles match before publishing. Body:
 *   { themes: string[], ratingMin: number|null, ratingMax: number|null }
 *
 * The theme clause is applied ONLY when `themes` is non-empty (mirrors the
 * selection ladder: `arr && '{}'` is false in Postgres, so we branch in TS).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ setId: string }> }
) {
  const tutor = await getTutorActor();
  if (!tutor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { setId } = await params;
  // Scope by tutor (404 if foreign). `db` satisfies the PrismaTransaction the
  // helper expects; no write transaction is needed for a pure read.
  try {
    await getOwnedSetOrThrow(db, tutor, setId);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const themes: string[] = Array.isArray(body.themes)
    ? body.themes.filter((t: unknown): t is string => typeof t === "string" && t.length > 0)
    : [];
  const ratingMin = typeof body.ratingMin === "number" ? body.ratingMin : null;
  const ratingMax = typeof body.ratingMax === "number" ? body.ratingMax : null;

  const themeClause = themes.length > 0 ? Prisma.sql`AND p.themes && ${themes}::text[]` : Prisma.empty;
  const rows = await db.$queryRaw<{ count: bigint }[]>`
    SELECT count(*)::bigint AS count
    FROM "Puzzle" p
    WHERE (${ratingMin}::int IS NULL OR p.rating >= ${ratingMin}::int)
      AND (${ratingMax}::int IS NULL OR p.rating <= ${ratingMax}::int)
      ${themeClause}
  `;
  return NextResponse.json({ count: Number(rows[0].count) });
}
