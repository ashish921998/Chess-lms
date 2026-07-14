import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";

/** How stale a PENDING attempt must be before the sweep abandons it. */
export const PENDING_TTL_HOURS = 2;

/**
 * Abandon PENDING attempts older than the TTL. Idempotent: `WHERE status =
 * 'PENDING'` means already-terminal attempts are skipped. Abandoned attempts
 * award nothing and write no StudentPuzzle (the puzzle can be re-served).
 *
 * Extracted so tests drive it inside a rollback tx. Returns the number swept.
 */
export async function sweepStaleAttemptsTx(tx: PrismaTransaction): Promise<number> {
  const result = await tx.$executeRaw`
    UPDATE "Attempt" SET status = 'ABANDONED', "finalizedAt" = NOW()
    WHERE status = 'PENDING' AND "createdAt" < NOW() - (${PENDING_TTL_HOURS} || ' hours')::interval
  `;
  return result;
}

/** Fields the Lichess sync needs from a LichessConnection + its student. */
export type LichessSyncTarget = {
  studentId: string;
  username: string;
};

/** The ratings parsed from a Lichess public user payload. */
export type LichessUserPerfs = {
  puzzle?: { rating: number };
  rapid?: { rating: number };
  blitz?: { rating: number };
};

export type LichessSyncOutcome =
  | { kind: "updated"; puzzleRating: number | null; gameRating: number | null }
  | { kind: "skipped"; reason: "rate_limited" | "error" };

/**
 * Apply one student's synced Lichess ratings inside a transaction. Sets
 * lichessPuzzleRating/lichessGameRating + lastSyncedAt. NEVER touches inAppRating
 * (the init guard holds — linking after practice doesn't overwrite skill).
 *
 * Extracted so the persistence half is testable without the network.
 */
export async function applyLichessSyncTx(
  tx: PrismaTransaction,
  target: LichessSyncTarget,
  perfs: LichessUserPerfs
): Promise<void> {
  const puzzleRating = perfs.puzzle?.rating ?? null;
  const gameRating = perfs.rapid?.rating ?? perfs.blitz?.rating ?? null;

  await tx.student.update({
    where: { id: target.studentId },
    data: { lichessPuzzleRating: puzzleRating, lichessGameRating: gameRating },
  });
  await tx.lichessConnection.update({
    where: { studentId: target.studentId },
    data: { lastSyncedAt: new Date() },
  });
}

/**
 * Fetch a user's public perfs from Lichess. Returns null on 429 (rate-limited)
 * so the caller can skip the student and leave previous values intact; throws
 * on other failures. Isolated so tests mock it.
 */
export async function fetchLichessUser(
  username: string
): Promise<LichessUserPerfs | null> {
  const res = await fetch(`https://lichess.org/api/user/${encodeURIComponent(username)}`);
  if (res.status === 429) return null; // rate-limited — skip, retry next run
  if (!res.ok) throw new Error(`Lichess /api/user/${username} failed: ${res.status}`);
  const data = (await res.json()) as { perfs?: LichessUserPerfs };
  return data.perfs ?? {};
}

/**
 * Verify the CRON_SECRET bearer header. Returns true if the request is
 * authorized to run a cron job, false otherwise.
 */
export function isCronAuthorized(authHeader: string | null): boolean {
  if (!process.env.CRON_SECRET) return false;
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}
