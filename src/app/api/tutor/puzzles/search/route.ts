import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTutorActor } from "@/lib/auth-guards";
import { searchPuzzlesTx } from "@/lib/tutor/sets";

/**
 * GET /api/tutor/puzzles/search?ratingMin=&ratingMax=&themes=a,b&limit=
 * Library search for MANUAL add-by-search. Themes empty ⇒ any theme. Read-only,
 * capped at 200. Used by the MANUAL editor's search box.
 */
export async function GET(req: NextRequest) {
  const tutor = await getTutorActor();
  if (!tutor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const ratingMin = sp.get("ratingMin");
  const ratingMax = sp.get("ratingMax");
  const themesParam = sp.get("themes");
  const limit = sp.get("limit");

  const puzzles = await searchPuzzlesTx(db, {
    ratingMin: ratingMin ? Number(ratingMin) : null,
    ratingMax: ratingMax ? Number(ratingMax) : null,
    themes: themesParam ? themesParam.split(",").map((t) => t.trim()).filter(Boolean) : [],
    limit: limit ? Number(limit) : 50,
  });
  return NextResponse.json({ puzzles });
}
