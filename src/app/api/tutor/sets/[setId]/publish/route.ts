import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTutorActor } from "@/lib/auth-guards";
import { publishSetTx, tutorErrorResponse } from "@/lib/tutor/sets";

/**
 * POST /api/tutor/sets/[setId]/publish — materialize an immutable
 * PuzzleSetVersion from the current draft and mark the set published.
 *
 *   MANUAL → version items from current PuzzleSetItems (in order).
 *   FILTER → frozen criteria on the version; no items.
 *
 * `version` is monotonic per set. Editing a published set does not touch
 * existing versions; a re-publish creates version + 1.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ setId: string }> }
) {
  const tutor = await getTutorActor();
  if (!tutor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { setId } = await params;
  try {
    const version = await db.$transaction((tx) => publishSetTx(tx, tutor, setId));
    return NextResponse.json(
      { id: version.id, version: version.version, mode: version.mode },
      { status: 201 }
    );
  } catch (e) {
    const res = tutorErrorResponse(e);
    if (res) return NextResponse.json(res.body, { status: res.status });
    throw e;
  }
}
