import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTutorActor } from "@/lib/auth-guards";
import { updateSetTx, deleteSetTx, tutorErrorResponse } from "@/lib/tutor/sets";

/** PATCH /api/tutor/sets/[setId] — mutate the draft (title/description/FILTER criteria). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ setId: string }> }
) {
  const tutor = await getTutorActor();
  if (!tutor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { setId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    const set = await db.$transaction((tx) =>
      updateSetTx(tx, tutor, setId, {
        title: body.title,
        description: body.description,
        filterThemes: body.filterThemes,
        filterRatingMin: body.filterRatingMin ?? undefined,
        filterRatingMax: body.filterRatingMax ?? undefined,
        targetCount: body.targetCount ?? undefined,
      })
    );
    return NextResponse.json({ id: set.id, isPublished: set.isPublished });
  } catch (e) {
    const res = tutorErrorResponse(e);
    if (res) return NextResponse.json(res.body, { status: res.status });
    throw e;
  }
}

/** DELETE /api/tutor/sets/[setId] — delete a set (cascade removes items/versions). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ setId: string }> }
) {
  const tutor = await getTutorActor();
  if (!tutor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { setId } = await params;
  try {
    await db.$transaction((tx) => deleteSetTx(tx, tutor, setId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const res = tutorErrorResponse(e);
    if (res) return NextResponse.json(res.body, { status: res.status });
    throw e;
  }
}
