import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStudentActor } from "@/lib/auth-guards";
import { Chess } from "chess.js";

/**
 * POST /api/attempts — issue a puzzle. Returns an OPAQUE presentation:
 * the client never receives solutionMoves. One PENDING attempt per student
 * (enforced by the partial unique index); if one exists, return it.
 *
 * Body: { puzzleId: string }   (M1: client picks from the dashboard list)
 * In M2 this becomes /api/puzzles/next with auto-queue selection.
 */
export async function POST(req: NextRequest) {
  const student = await getStudentActor();
  if (!student) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { puzzleId } = await req.json();
  if (!puzzleId) {
    return NextResponse.json({ error: "puzzleId required" }, { status: 400 });
  }

  // Verify the puzzle exists.
  const puzzle = await db.puzzle.findUnique({ where: { id: puzzleId } });
  if (!puzzle) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Single-flight: lock the student row, then check for an existing PENDING.
  // The partial unique index one_pending_attempt is the backstop — if two
  // requests race past the lock, the second insert throws and we catch it.
  try {
    return await db.$transaction(async (tx) => {
      // Lock the student row.
      await tx.$executeRaw`SELECT 1 FROM "Student" WHERE id = ${student.id} FOR UPDATE`;

      // Any existing PENDING attempt for this student? Return it (resume).
      const existing = await tx.attempt.findFirst({
        where: { studentId: student.id, status: "PENDING" },
        include: { puzzle: true },
      });
      if (existing) {
        return NextResponse.json(presentAttempt(existing, existing.puzzle));
      }

      // isReplay = has the student already solved this puzzle before?
      const alreadySeen = await tx.studentPuzzle.findUnique({
        where: {
          studentId_puzzleId: { studentId: student.id, puzzleId: puzzle.id },
        },
      });

      const attempt = await tx.attempt.create({
        data: {
          studentId: student.id,
          puzzleId: puzzle.id,
          status: "PENDING",
          isReplay: alreadySeen !== null,
        },
      });

      return NextResponse.json(presentAttempt(attempt, puzzle));
    });
  } catch (e) {
    // The partial unique index may have fired if two issuances raced.
    // Retry once by reading the now-existing PENDING attempt.
    const existing = await db.attempt.findFirst({
      where: { studentId: student.id, status: "PENDING" },
      include: { puzzle: true },
    });
    if (existing) return NextResponse.json(presentAttempt(existing, existing.puzzle));
    throw e;
  }
}

/**
 * Build the opaque client presentation. Computes the current board FEN by
 * replaying solutionMoves[0..moveIndex-1] from startFen. Never includes
 * solutionMoves in the response.
 */
function presentAttempt(
  attempt: { id: string; moveIndex: number; puzzleId: string },
  puzzle: { startFen: string; solutionMoves: string[]; themes: string[] }
) {
  // Reconstruct the current FEN at the attempt's cursor.
  let fen = puzzle.startFen;
  if (attempt.moveIndex > 0) {
    const game = new Chess(puzzle.startFen);
    for (let i = 0; i < attempt.moveIndex; i++) {
      try {
        game.move(puzzle.solutionMoves[i]);
      } catch {
        break; // defensive — shouldn't happen with validated data
      }
    }
    fen = game.fen();
  }

  return {
    attemptId: attempt.id,
    fen,
    themes: puzzle.themes,
    expectedRevision: attempt.moveIndex, // for M1, revision tracks moveIndex
  };
}
