import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTutorActor } from "@/lib/auth-guards";

/**
 * PATCH /api/tutor/goals — set daily goals.
 *
 * Body is one of:
 *   { studentId: string, dailyGoal: number }   — single student
 *   { all: true, dailyGoal: number }            — every student in the roster
 *
 * Guarded by getTutorActor(); scoped by tutorId. A studentId not in the tutor's
 * roster → 404 (no existence leak). Validates dailyGoal is an integer ≥ 1.
 */
export async function PATCH(req: NextRequest) {
  const tutor = await getTutorActor();
  if (!tutor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dailyGoal = Number(body.dailyGoal);

  if (!Number.isInteger(dailyGoal) || dailyGoal < 1) {
    return NextResponse.json({ error: "dailyGoal must be an integer >= 1" }, { status: 400 });
  }

  // Class-wide update.
  if (body.all === true) {
    await db.student.updateMany({
      where: { tutorId: tutor.id },
      data: { dailyGoal },
    });
    return NextResponse.json({ all: true, dailyGoal });
  }

  // Single-student update — scope to the tutor's roster (404 if not owned).
  if (typeof body.studentId !== "string") {
    return NextResponse.json({ error: "studentId or all required" }, { status: 400 });
  }
  const student = await db.student.findUnique({
    where: { id: body.studentId },
    select: { id: true, tutorId: true },
  });
  if (!student || student.tutorId !== tutor.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await db.student.update({
    where: { id: student.id },
    data: { dailyGoal },
  });
  return NextResponse.json({ studentId: student.id, dailyGoal });
}
