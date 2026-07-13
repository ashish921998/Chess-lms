import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTutorActor } from "@/lib/auth-guards";
import { assignVersionTx, tutorErrorResponse } from "@/lib/tutor/sets";

/**
 * POST /api/tutor/assignments — assign a version to student(s).
 *
 * Body:
 *   { versionId: string, studentIds: string[], dueDate?: string (ISO) }
 *
 * Idempotent per (version, student): existing assignments are skipped, in-flight
 * progress preserved. MANUAL → materializes AssignmentItemProgress; FILTER →
 * copies targetCount, no items. Returns `{ created, skipped }`.
 */
export async function POST(req: NextRequest) {
  const tutor = await getTutorActor();
  if (!tutor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.versionId !== "string" || !Array.isArray(body.studentIds)) {
    return NextResponse.json(
      { error: "versionId and studentIds[] required" },
      { status: 400 }
    );
  }
  if (body.studentIds.length === 0) {
    return NextResponse.json({ error: "studentIds must not be empty" }, { status: 400 });
  }
  const dueDate =
    typeof body.dueDate === "string" && body.dueDate ? new Date(body.dueDate) : null;

  try {
    const result = await db.$transaction((tx) =>
      assignVersionTx(tx, tutor, body.versionId, body.studentIds, dueDate)
    );
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    const res = tutorErrorResponse(e);
    if (res) return NextResponse.json(res.body, { status: res.status });
    throw e;
  }
}
