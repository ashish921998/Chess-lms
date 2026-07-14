import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sweepStaleAttemptsTx, isCronAuthorized } from "@/lib/gamification/cron";

/**
 * POST /api/cron/sweep-attempts — abandon PENDING attempts older than 2h.
 * Hourly (vercel.json). CRON_SECRET-protected and idempotent: already-terminal
 * attempts are skipped by the `WHERE status = 'PENDING'` gate. Abandoned
 * attempts award nothing and write no StudentPuzzle, so the puzzle can be
 * re-served.
 */
export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const swept = await db.$transaction((tx) => sweepStaleAttemptsTx(tx));
  return NextResponse.json({ swept });
}
