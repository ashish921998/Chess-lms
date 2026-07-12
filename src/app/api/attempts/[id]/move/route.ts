import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStudentActor } from "@/lib/auth-guards";
import { validateMove } from "@/lib/puzzles/validate";
import { eloDelta, kFactorFor } from "@/lib/rating";
import { Chess } from "chess.js";

const SOLVE_REWARD_NO_HINT = 10;
const SOLVE_REWARD_HINTED = 5;
const FAIL_LIMIT = 2;
const GOAL_BONUS = 50;

/**
 * POST /api/attempts/[id]/move — submit one student move.
 *
 * Body: { move: "e2e4", expectedRevision: n }
 *
 * The server validates the move against the stored solution (never sent to the
 * client) and conditionally advances the cursor or finalizes the attempt.
 * Finalization is one atomic transaction: status flip + ledger credit (ON
 * CONFLICT DO NOTHING RETURNING) + DailyProgress + Elo + StudentPuzzle.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const student = await getStudentActor();
  if (!student) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: attemptId } = await params;
  const { move: uci, expectedRevision } = await req.json();

  if (!uci || typeof expectedRevision !== "number") {
    return NextResponse.json({ error: "move and expectedRevision required" }, { status: 400 });
  }

  // Load attempt + puzzle, verify ownership.
  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    include: { puzzle: true },
  });
  if (!attempt || attempt.studentId !== student.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (attempt.status !== "PENDING") {
    return NextResponse.json({ error: "attempt_finalized", status: attempt.status }, { status: 409 });
  }
  if (attempt.revision !== expectedRevision) {
    return NextResponse.json(
      { error: "revision_mismatch", expectedRevision: attempt.revision },
      { status: 409 }
    );
  }

  const result = validateMove({
    startFen: attempt.puzzle.startFen,
    solutionMoves: attempt.puzzle.solutionMoves,
    moveIndex: attempt.moveIndex,
    uci,
  });

  switch (result.kind) {
    case "illegal":
      return NextResponse.json({ status: "illegal" });

    case "incorrect": {
      const newFailCount = attempt.failCount + 1;
      if (newFailCount >= FAIL_LIMIT) {
        await finalizeFailed(attempt, student.id);
        return NextResponse.json({ status: "failed", failCount: newFailCount });
      }
      // Advance revision (wrong move counted), stay PENDING.
      await db.attempt.update({
        where: { id: attemptId, status: "PENDING", revision: expectedRevision },
        data: { failCount: newFailCount, revision: { increment: 1 } },
      });
      return NextResponse.json({ status: "incorrect", failCount: newFailCount });
    }

    case "continue": {
      // Conditional cursor advance — serializes parallel moves.
      const updated = await db.attempt.updateMany({
        where: { id: attemptId, status: "PENDING", revision: expectedRevision },
        data: {
          moveIndex: result.nextMoveIndex,
          revision: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        return NextResponse.json(
          { error: "revision_mismatch", expectedRevision: result.nextMoveIndex },
          { status: 409 }
        );
      }
      // Compute the FEN after both the student move and opponent reply.
      const fen = advanceFen(attempt.puzzle.startFen, attempt.puzzle.solutionMoves, result.nextMoveIndex);
      return NextResponse.json({
        status: "continue",
        expectedRevision: expectedRevision + 1,
        opponentMove: result.opponentReplyUci,
        fen,
      });
    }

    case "solved": {
      const coinsAwarded = await finalizeSolved(attempt, student.id);
      return NextResponse.json({ status: "solved", coinsAwarded });
    }
  }
}

/**
 * Finalize a SOLVED attempt in one atomic transaction:
 * 1. Conditional status flip (PENDING → SOLVED) — concurrent finalizes are no-ops.
 * 2. Ledger credit via ON CONFLICT DO NOTHING RETURNING — first solve of the
 *    puzzle credits; replays (already in StudentPuzzle) get nothing.
 * 3. Write StudentPuzzle (anti-repeat) — only on solve.
 * 4. Upsert DailyProgress, award goal bonus if threshold met.
 * 5. Elo update (serialized via Student-row FOR UPDATE) — replays skip.
 * 6. Assignment progress if applicable.
 */
async function finalizeSolved(
  attempt: { id: string; puzzleId: string; studentId: string; usedHint: boolean; isReplay: boolean; assignmentItemId: string | null; puzzle: { rating: number; startFen: string; solutionMoves: string[] } },
  _studentId: string
): Promise<number> {
  const reward = attempt.usedHint ? SOLVE_REWARD_HINTED : SOLVE_REWARD_NO_HINT;
  const idempotencyKey = `solve:${attempt.studentId}:${attempt.puzzleId}`;

  return db.$transaction(async (tx) => {
    // 1. Conditional status flip.
    const flipped = await tx.$executeRaw`
      UPDATE "Attempt" SET status = 'SOLVED', solved = true, "finalizedAt" = NOW(), revision = revision + 1
      WHERE id = ${attempt.id} AND status = 'PENDING'
    `;
    if (flipped === 0) {
      // Race lost — another request already finalized this attempt.
      // Return the coinsAwarded already on the row.
      const existing = await tx.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
      return existing.coinsAwarded;
    }

    // 2. Ledger credit via ON CONFLICT DO NOTHING RETURNING.
    const creditRow = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "CoinTransaction" (id, "studentId", amount, reason, "idempotencyKey", "refId", "createdAt")
      VALUES (gen_random_uuid(), ${attempt.studentId}, ${reward}, ${attempt.usedHint ? "SOLVE_HINTED" : "SOLVE"}, ${idempotencyKey}, ${attempt.id}, NOW())
      ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id
    `;

    const isReplaySolve = creditRow.length === 0; // no row returned = already solved before

    if (!isReplaySolve) {
      // First-ever solve of this puzzle — credit coins.
      await tx.student.update({
        where: { id: attempt.studentId },
        data: {
          coinBalance: { increment: reward },
          lifetimeCoins: { increment: reward },
        },
      });
      await tx.attempt.update({
        where: { id: attempt.id },
        data: { coinsAwarded: reward },
      });
    } else {
      // Replay — no coins, mark the attempt.
      await tx.attempt.update({
        where: { id: attempt.id },
        data: { coinsAwarded: 0, isReplay: true },
      });
    }

    // 3. Write StudentPuzzle (permanent anti-repeat) — only on solve.
    await tx.$executeRaw`
      INSERT INTO "StudentPuzzle" ("studentId", "puzzleId", "firstSeenAt", "lastSeenAt", "timesSeen")
      VALUES (${attempt.studentId}, ${attempt.puzzleId}, NOW(), NOW(), 1)
      ON CONFLICT ("studentId", "puzzleId") DO UPDATE SET "lastSeenAt" = NOW(), "timesSeen" = "StudentPuzzle"."timesSeen" + 1
    `;

    // 4. DailyProgress — today in the student's local timezone.
    const today = new Date(); // M1: assume UTC; M4 will use the student's IANA tz
    const dateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dp = await tx.dailyProgress.upsert({
      where: { studentId_date: { studentId: attempt.studentId, date: dateOnly } },
      update: { solvedCount: { increment: 1 } },
      create: { studentId: attempt.studentId, date: dateOnly, solvedCount: 1 },
    });

    // Goal bonus: if this solve met the daily goal and we haven't already bonused.
    const studentRow = await tx.student.findUniqueOrThrow({ where: { id: attempt.studentId } });
    if (dp.solvedCount >= studentRow.dailyGoal && !dp.goalBonusAwarded) {
      const goalKey = `goal:${attempt.studentId}:${dateOnly.toISOString().slice(0, 10)}`;
      const goalCredit = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "CoinTransaction" (id, "studentId", amount, reason, "idempotencyKey", "createdAt")
        VALUES (gen_random_uuid(), ${attempt.studentId}, ${GOAL_BONUS}, 'GOAL_BONUS', ${goalKey}, NOW())
        ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id
      `;
      if (goalCredit.length > 0) {
        await tx.student.update({
          where: { id: attempt.studentId },
          data: {
            coinBalance: { increment: GOAL_BONUS },
            lifetimeCoins: { increment: GOAL_BONUS },
          },
        });
        await tx.dailyProgress.update({
          where: { studentId_date: { studentId: attempt.studentId, date: dateOnly } },
          data: { goalBonusAwarded: true, goalMet: true },
        });
      }
    } else if (dp.solvedCount >= studentRow.dailyGoal) {
      await tx.dailyProgress.update({
        where: { studentId_date: { studentId: attempt.studentId, date: dateOnly } },
        data: { goalMet: true },
      });
    }

    // 5. Elo update — replays skip entirely. Serialized via Student row lock.
    if (!attempt.isReplay && !isReplaySolve) {
      await tx.$executeRaw`SELECT 1 FROM "Student" WHERE id = ${attempt.studentId} FOR UPDATE`;
      const lockedStudent = await tx.student.findUniqueOrThrow({ where: { id: attempt.studentId } });
      const ratedCount = await tx.ratingEvent.count({ where: { studentId: attempt.studentId } });
      const k = kFactorFor(ratedCount);
      const delta = eloDelta(lockedStudent.inAppRating, attempt.puzzle.rating, 1, k);
      const newRating = lockedStudent.inAppRating + delta;
      const newK = kFactorFor(ratedCount + 1);

      await tx.student.update({
        where: { id: attempt.studentId },
        data: { inAppRating: newRating, ratingK: newK },
      });
      await tx.ratingEvent.create({
        data: {
          studentId: attempt.studentId,
          rating: newRating,
          outcome: "SOLVED",
          delta,
          attemptId: attempt.id,
        },
      });
    }

    // 6. Assignment progress if this attempt serves an assignment item.
    if (attempt.assignmentItemId) {
      const flippedItem = await tx.assignmentItemProgress.updateMany({
        where: { id: attempt.assignmentItemId, solved: false },
        data: { solved: true, firstSolvedAt: new Date(), attempts: { increment: 1 } },
      });
      if (flippedItem.count > 0) {
        // Atomic increment of assignment progress (never count-and-set).
        const item = await tx.assignmentItemProgress.findUniqueOrThrow({
          where: { id: attempt.assignmentItemId },
        });
        await tx.assignment.update({
          where: { id: item.assignmentId },
          data: { progress: { increment: 1 } },
        });
      }
    }

    return isReplaySolve ? 0 : reward;
  });
}

/**
 * Finalize a FAILED attempt: apply Elo with actual=0 (rating drops), unless
 * this is a replay (replays skip Elo entirely per the spec).
 */
async function finalizeFailed(
  attempt: { id: string; puzzleId: string; studentId: string; isReplay: boolean; assignmentItemId: string | null; puzzle: { rating: number } },
  _studentId: string
): Promise<void> {
  await db.$transaction(async (tx) => {
    const flipped = await tx.$executeRaw`
      UPDATE "Attempt" SET status = 'FAILED', "finalizedAt" = NOW(), revision = revision + 1
      WHERE id = ${attempt.id} AND status = 'PENDING'
    `;
    if (flipped === 0) return; // race lost

    // Elo with actual=0 — but replays skip entirely.
    if (!attempt.isReplay) {
      await tx.$executeRaw`SELECT 1 FROM "Student" WHERE id = ${attempt.studentId} FOR UPDATE`;
      const lockedStudent = await tx.student.findUniqueOrThrow({ where: { id: attempt.studentId } });
      const ratedCount = await tx.ratingEvent.count({ where: { studentId: attempt.studentId } });
      const k = kFactorFor(ratedCount);
      const delta = eloDelta(lockedStudent.inAppRating, attempt.puzzle.rating, 0, k);
      const newRating = lockedStudent.inAppRating + delta;
      const newK = kFactorFor(ratedCount + 1);

      await tx.student.update({
        where: { id: attempt.studentId },
        data: { inAppRating: newRating, ratingK: newK },
      });
      await tx.ratingEvent.create({
        data: {
          studentId: attempt.studentId,
          rating: newRating,
          outcome: "FAILED",
          delta,
          attemptId: attempt.id,
        },
      });
    }

    // Increment assignment item attempts (engagement tracking, not rating).
    if (attempt.assignmentItemId) {
      await tx.assignmentItemProgress.update({
        where: { id: attempt.assignmentItemId },
        data: { attempts: { increment: 1 } },
      });
    }
  });
}

/** Reconstruct the board FEN after advancing the cursor to nextMoveIndex. */
function advanceFen(startFen: string, solutionMoves: string[], nextMoveIndex: number): string {
  const game = new Chess(startFen);
  for (let i = 0; i < nextMoveIndex; i++) {
    try {
      game.move(solutionMoves[i]);
    } catch {
      break;
    }
  }
  return game.fen();
}
