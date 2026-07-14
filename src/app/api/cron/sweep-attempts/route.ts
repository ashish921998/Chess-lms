import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sweepStaleAttemptsTx, isCronAuthorized } from "@/lib/gamification/cron";

/**
 * /api/cron/sweep-attempts — abandon PENDING attempts older than 2h.
 * Hourly (vercel.json). CRON_SECRET-protected and idempotent: already-terminal
 * attempts are skipped by the `WHERE status = 'PENDING'` gate. Abandoned
 * attempts award nothing and write no StudentPuzzle, so the puzzle can be
 * re-served.
 *
 * Vercel Cron invokes the path with GET, so GET is the primary export. POST is
 * kept as an alias for manual triggering (same CRON_SECRET gate).
 */
async function sweepHandler(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const swept = await db.$transaction((tx) => sweepStaleAttemptsTx(tx));
  return NextResponse.json({ swept });
}

export const GET = sweepHandler;
export const POST = sweepHandler;
