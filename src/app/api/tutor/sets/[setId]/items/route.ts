import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTutorActor } from "@/lib/auth-guards";
import { addPuzzleItemTx, removePuzzleItemTx, tutorErrorResponse } from "@/lib/tutor/sets";

/**
 * POST /api/tutor/sets/[setId]/items — add a puzzle to a MANUAL set's draft.
 * Body: { puzzleId }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ setId: string }> }
) {
  const tutor = await getTutorActor();
  if (!tutor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { setId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.puzzleId !== "string") {
    return NextResponse.json({ error: "puzzleId required" }, { status: 400 });
  }

  try {
    const item = await db.$transaction((tx) => addPuzzleItemTx(tx, tutor, setId, body.puzzleId));
    return NextResponse.json({ id: item.id, order: item.order }, { status: 201 });
  } catch (e) {
    const res = tutorErrorResponse(e);
    if (res) return NextResponse.json(res.body, { status: res.status });
    throw e;
  }
}

/**
 * DELETE /api/tutor/sets/[setId]/items?puzzleId=... — remove a puzzle from a
 * MANUAL set's draft.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ setId: string }> }
) {
  const tutor = await getTutorActor();
  if (!tutor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { setId } = await params;
  const puzzleId = new URL(req.url).searchParams.get("puzzleId");
  if (!puzzleId) return NextResponse.json({ error: "puzzleId required" }, { status: 400 });

  try {
    await db.$transaction((tx) => removePuzzleItemTx(tx, tutor, setId, puzzleId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const res = tutorErrorResponse(e);
    if (res) return NextResponse.json(res.body, { status: res.status });
    throw e;
  }
}
