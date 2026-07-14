import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStudentActor } from "@/lib/auth-guards";
import { purchaseSkipTx, type SpendAttempt } from "@/lib/gamification/spend";

/**
 * POST /api/attempts/[id]/skip — skip the current puzzle for 30 coins.
 *
 * Finalizes the attempt as SKIPPED: no Elo, no StudentPuzzle, streak-neutral.
 * Idempotent on an already-skipped attempt (no re-charge). Ownership-checked;
 * the spend runs inside one atomic transaction.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const student = await getStudentActor();
  if (!student) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: attemptId } = await params;

  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    include: { puzzle: true },
  });
  if (!attempt || attempt.studentId !== student.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const spendAttempt: SpendAttempt = {
    id: attempt.id,
    studentId: attempt.studentId,
    status: attempt.status,
    usedHint: attempt.usedHint,
    hintMove: attempt.hintMove,
    moveIndex: attempt.moveIndex,
    solutionMoves: attempt.puzzle.solutionMoves,
  };

  let result;
  try {
    result = await db.$transaction((tx) => purchaseSkipTx(tx, spendAttempt));
  } catch {
    // The attempt was finalized concurrently mid-spend — the charge rolled back.
    return NextResponse.json({ error: "attempt_not_pending" }, { status: 409 });
  }

  switch (result.kind) {
    case "skipped":
      return NextResponse.json({ status: "skipped" });
    case "attempt_not_pending":
      return NextResponse.json(
        { error: "attempt_not_pending" },
        { status: 409 }
      );
    case "insufficient_funds":
      return NextResponse.json(
        { error: "insufficient_funds" },
        { status: 402 }
      );
  }
}
