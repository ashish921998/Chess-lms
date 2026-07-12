import { requireStudent } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { PuzzleBoard } from "@/components/chess/puzzle-board";
import { Chess } from "chess.js";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Practice page for a specific puzzle. Creates a PENDING attempt (or resumes
 * an existing one) and renders the interactive board. The client never sees
 * the solution — all move validation is server-side via /api/attempts/[id]/move.
 */
export default async function PracticePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireStudent();
  const { id: puzzleId } = await params;

  const puzzle = await db.puzzle.findUnique({ where: { id: puzzleId } });
  if (!puzzle) notFound();

  // Single-flight: lock the student, check for existing PENDING, create if none.
  // (Same logic as POST /api/attempts, but in-process for a server component.)
  const attempt = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Student" WHERE id = ${me.id} FOR UPDATE`;

    const existing = await tx.attempt.findFirst({
      where: { studentId: me.id, status: "PENDING" },
    });

    if (existing) {
      // If the existing PENDING is for a DIFFERENT puzzle, abandon it and issue
      // the requested one (context switch per spec §Issuing).
      if (existing.puzzleId !== puzzleId) {
        await tx.attempt.update({
          where: { id: existing.id },
          data: { status: "ABANDONED", finalizedAt: new Date() },
        });
      } else {
        return existing; // resume the in-flight attempt
      }
    }

    const alreadySeen = await tx.studentPuzzle.findUnique({
      where: {
        studentId_puzzleId: { studentId: me.id, puzzleId: puzzle.id },
      },
    });

    return tx.attempt.create({
      data: {
        studentId: me.id,
        puzzleId: puzzle.id,
        status: "PENDING",
        isReplay: alreadySeen !== null,
      },
    });
  });

  // Reconstruct the current FEN at the attempt's cursor (== startFen for fresh).
  let fen = puzzle.startFen;
  if (attempt.moveIndex > 0) {
    const game = new Chess(puzzle.startFen);
    for (let i = 0; i < attempt.moveIndex; i++) {
      try {
        game.move(puzzle.solutionMoves[i]);
      } catch {
        break;
      }
    }
    fen = game.fen();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-semibold">
            Puzzle ·{" "}
            <span className="font-mono text-slate-500">{puzzle.id}</span>
          </h1>
          <p className="text-sm text-slate-500">
            Rating {puzzle.rating}
            {puzzle.themes.length > 0 && ` · ${puzzle.themes.join(", ")}`}
            {attempt.isReplay && (
              <span className="ml-2 text-amber-600">· replay (no coins)</span>
            )}
          </p>
        </div>
        <a href="/dashboard" className="text-sm text-slate-500 hover:text-slate-900">
          ← Back
        </a>
      </div>

      <PuzzleBoard
        attemptId={attempt.id}
        startFen={fen}
        solutionLength={puzzle.solutionMoves.length}
        initialRevision={attempt.revision}
      />
    </div>
  );
}
