import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStudentActor } from "@/lib/auth-guards";
import { validateMove } from "@/lib/puzzles/validate";
import {
  finalizeSolvedTx,
  finalizeFailedTx,
  FAIL_LIMIT,
  type FinalizeAttempt,
} from "@/lib/puzzles/finalize";
import { Chess } from "chess.js";

/**
 * POST /api/attempts/[id]/move — submit one student move.
 *
 * Body: { move: "e2e4", expectedRevision: n }
 *
 * The server validates the move against the stored solution (never sent to the
 * client) and conditionally advances the cursor or finalizes the attempt.
 * Finalization is one atomic transaction: status flip + ledger credit (ON
 * CONFLICT DO NOTHING RETURNING) + DailyProgress + Elo + StudentPuzzle +
 * assignment progress (MANUAL item flip / FILTER LEAST cap).
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
        await db.$transaction((tx) => finalizeFailedTx(tx, toFinalizeAttempt(attempt)));
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
      const coinsAwarded = await db.$transaction((tx) =>
        finalizeSolvedTx(tx, toFinalizeAttempt(attempt))
      );
      return NextResponse.json({ status: "solved", coinsAwarded });
    }
  }
}

/** Shape the loaded attempt (+puzzle) into the FinalizeAttempt the logic wants. */
function toFinalizeAttempt(
  attempt: {
    id: string;
    puzzleId: string;
    studentId: string;
    usedHint: boolean;
    isReplay: boolean;
    assignmentId: string | null;
    assignmentItemId: string | null;
    puzzle: { rating: number; startFen: string; solutionMoves: string[] };
  }
): FinalizeAttempt {
  return {
    id: attempt.id,
    puzzleId: attempt.puzzleId,
    studentId: attempt.studentId,
    usedHint: attempt.usedHint,
    isReplay: attempt.isReplay,
    assignmentId: attempt.assignmentId,
    assignmentItemId: attempt.assignmentItemId,
    puzzle: attempt.puzzle,
  };
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
