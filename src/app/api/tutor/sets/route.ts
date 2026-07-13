import { NextRequest, NextResponse } from "next/server";
import { SetMode } from "@prisma/client";
import { db } from "@/lib/db";
import { getTutorActor } from "@/lib/auth-guards";
import { createSetTx, ValidationError } from "@/lib/tutor/sets";

/**
 * POST /api/tutor/sets — create a puzzle set (MANUAL or FILTER).
 *
 * Body:
 *   { title, description?, mode: "MANUAL"|"FILTER",
 *     filterThemes?, filterRatingMin?, filterRatingMax?, targetCount? }
 *
 * Mode invariants enforced in createSetTx → 400 on violation.
 */
export async function POST(req: NextRequest) {
  const tutor = await getTutorActor();
  if (!tutor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || !body.title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  if (body.mode !== "MANUAL" && body.mode !== "FILTER") {
    return NextResponse.json({ error: "mode must be MANUAL or FILTER" }, { status: 400 });
  }

  try {
    const set = await db.$transaction((tx) =>
      createSetTx(tx, tutor.id, {
        title: body.title,
        description: body.description,
        mode: body.mode as SetMode,
        filterThemes: body.filterThemes,
        filterRatingMin: body.filterRatingMin ?? null,
        filterRatingMax: body.filterRatingMax ?? null,
        targetCount: body.targetCount ?? null,
      })
    );
    return NextResponse.json({ id: set.id }, { status: 201 });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
