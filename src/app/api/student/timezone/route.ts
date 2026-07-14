import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStudentActor } from "@/lib/auth-guards";

/**
 * PATCH /api/student/timezone — set the student's IANA timezone. Streak and
 * daily-goal boundaries respect this. Validates the tz is a real IANA zone via
 * Intl.supportedValuesOf('timeZone').
 */
export async function PATCH(req: NextRequest) {
  const student = await getStudentActor();
  if (!student) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { timezone } = await req.json();
  if (typeof timezone !== "string" || !isValidTimezone(timezone)) {
    return NextResponse.json({ error: "invalid_timezone" }, { status: 400 });
  }

  await db.student.update({
    where: { id: student.id },
    data: { timezone },
  });
  return NextResponse.json({ timezone });
}

/** True iff `tz` is a real IANA timezone the runtime knows about. */
function isValidTimezone(tz: string): boolean {
  // Intl.supportedValuesOf is available in Node 18+ and modern browsers.
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
  if (!supported) return Boolean(Intl.DateTimeFormat(undefined, { timeZone: tz }));
  return supported.includes(tz);
}
