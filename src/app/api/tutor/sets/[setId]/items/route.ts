import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTutorActor } from "@/lib/auth-guards";
import {
  addPuzzleItemTx,
  getOwnedSetOrThrow,
  removePuzzleItemTx,
  reorderItemsTx,
  tutorErrorResponse,
} from "@/lib/tutor/sets";

/**
 * GET /api/tutor/sets/[setId]/items — list the puzzle IDs in a MANUAL set's
 * draft. Used by the library browser to mark already-added puzzles.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ setId: string }> }
) {
  const tutor = await getTutorActor();
  if (!tutor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { setId } = await params;
  try {
    const items = await db.$transaction(async (tx) => {
      await getOwnedSetOrThrow(tx, tutor, setId);
      return tx.puzzleSetItem.findMany({
        where: { setId },
        select: { puzzleId: true },
        orderBy: { order: "asc" },
      });
    });
    return NextResponse.json({ puzzleIds: items.map((i) => i.puzzleId) });
  } catch (e) {
    const res = tutorErrorResponse(e);
    if (res) return NextResponse.json(res.body, { status: res.status });
    throw e;
  }
}

/**
 * POST /api/tutor/sets/[setId]/items — add a puzzle to a MANUAL set's draft.
 * Body: { puzzleId: string }
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
 * PATCH /api/tutor/sets/[setId]/items — reorder MANUAL items to match the given
 * puzzleId sequence. Body: { orderedPuzzleIds: string[] }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ setId: string }> }
) {
  const tutor = await getTutorActor();
  if (!tutor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { setId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.orderedPuzzleIds)) {
    return NextResponse.json({ error: "orderedPuzzleIds[] required" }, { status: 400 });
  }

  try {
    await db.$transaction((tx) => reorderItemsTx(tx, tutor, setId, body.orderedPuzzleIds));
    return NextResponse.json({ ok: true });
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
