import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  isCronAuthorized,
  fetchLichessUser,
  applyLichessSyncTx,
  type LichessSyncTarget,
} from "@/lib/gamification/cron";

/**
 * /api/cron/sync-lichess — daily Lichess rating sync.
 *
 * For each connected student: fetch their public perfs and write
 * lichessPuzzleRating/lichessGameRating + lastSyncedAt. On 429 (rate-limited)
 * the student is skipped with previous values intact; on any other failure the
 * previous values are also left intact. NEVER touches inAppRating. Sequential
 * with a small delay between requests to be polite to the Lichess API.
 *
 * Vercel Cron invokes the path with GET, so GET is the primary export. POST is
 * kept as an alias for manual triggering (same CRON_SECRET gate).
 */
async function syncHandler(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connections = await db.lichessConnection.findMany({
    select: { studentId: true, lichessUsername: true },
  });

  let synced = 0;
  let skipped = 0;
  for (const c of connections) {
    const target: LichessSyncTarget = { studentId: c.studentId, username: c.lichessUsername };
    try {
      const perfs = await fetchLichessUser(c.lichessUsername);
      if (perfs === null) {
        // Rate-limited — skip, leave previous values intact, retry next run.
        skipped++;
        continue;
      }
      await db.$transaction((tx) => applyLichessSyncTx(tx, target, perfs));
      synced++;
    } catch {
      // Any other failure — leave previous values intact, continue.
      skipped++;
    }
    // Be polite to the Lichess API: a short pause between requests.
    await sleep(250);
  }

  return NextResponse.json({ synced, skipped, total: connections.length });
}

export const GET = syncHandler;
export const POST = syncHandler;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
