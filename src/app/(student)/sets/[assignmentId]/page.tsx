import Link from "next/link";
import { notFound } from "next/navigation";
import { Chess } from "chess.js";
import { requireStudent } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { PuzzleBoard } from "@/components/chess/puzzle-board";
import { pickManualItem, selectFilterPuzzle } from "@/lib/puzzles/assignment-issuance";
import { versionTotal } from "@/lib/puzzles/version-total";

export const dynamic = "force-dynamic";

/**
 * Version-backed assignment solver at /sets/[assignmentId]. Generalizes the
 * existing `practice/[id]` inline-issuance pattern (Approach A): the student
 * row is locked, an existing PENDING attempt is resumed (same assignment) or
 * abandoned (different assignment or auto-queue), then a fresh puzzle is
 * derived from the assignment — via pickManualItem (MANUAL) or
 * selectFilterPuzzle (FILTER). The PuzzleBoard component is reused unchanged;
 * only the issuance differs.
 *
 * Completion is a rendered state, never a redirect: when no puzzle remains
 * (MANUAL: all items solved; FILTER: exhausted/completed) the page shows an
 * "assignment complete" message.
 */
export default async function AssignmentSolverPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const me = await requireStudent();
  const { assignmentId } = await params;

  // Coin balance drives the hint/skip disabled states + confirm popover.
  const balanceRow = await db.student.findUniqueOrThrow({
    where: { id: me.id },
    select: { coinBalance: true },
  });

  // Load the assignment; 404 if it isn't this student's (never reveal existence).
  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      version: {
        select: {
          mode: true,
          targetCount: true,
          set: { select: { title: true } },
          _count: { select: { items: true } },
        },
      },
    },
  });
  if (!assignment || assignment.studentId !== me.id) notFound();

  const total = versionTotal(assignment.version);

  // The issuance result: either an in-flight PENDING attempt to resume, a newly
  // issued one, or a "complete" terminal state.
  const issued = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Student" WHERE id = ${me.id} FOR UPDATE`;

    const existing = await tx.attempt.findFirst({
      where: { studentId: me.id, status: "PENDING" },
    });

    if (existing) {
      // Same assignment (any item/puzzle within it) → resume.
      if (existing.assignmentId === assignmentId) {
        return { kind: "resume" as const, attemptId: existing.id, puzzleId: existing.puzzleId };
      }
      // Different assignment OR auto-queue → abandon (awards nothing), then issue.
      await tx.attempt.update({
        where: { id: existing.id },
        data: { status: "ABANDONED", finalizedAt: new Date() },
      });
    }

    if (assignment.version.mode === "MANUAL") {
      const r = await pickManualItem(tx, assignmentId, me.id);
      if (r.kind === "COMPLETE") return { kind: "complete" as const };
      const attempt = await tx.attempt.create({
        data: {
          studentId: me.id,
          puzzleId: r.puzzle.id,
          status: "PENDING",
          isReplay: r.isReplay,
          assignmentId,
          assignmentItemId: r.assignmentItemId,
        },
      });
      return { kind: "issued" as const, attemptId: attempt.id, puzzleId: r.puzzle.id };
    }

    // FILTER
    const r = await selectFilterPuzzle(tx, assignmentId, me.id);
    if (r.kind === "COMPLETE") return { kind: "complete" as const };
    const attempt = await tx.attempt.create({
      data: {
        studentId: me.id,
        puzzleId: r.puzzle.id,
        status: "PENDING",
        isReplay: r.isReplay,
        assignmentId,
        assignmentItemId: null, // FILTER marker — finalizeSolved forks on this
      },
    });
    return { kind: "issued" as const, attemptId: attempt.id, puzzleId: r.puzzle.id };
  });

  // Terminal: nothing left to solve.
  if (issued.kind === "complete") {
    return (
      <AssignmentHeader title={assignment.version.set.title} progress={assignment.progress} total={total}>
        <div className="border border-line bg-panel p-8 text-center">
          <p className="font-serif text-lg tracking-tight text-success">
            {assignment.completed ? "Assignment complete! 🎉" : "No more puzzles match this assignment."}
          </p>
          <p className="mt-1 text-[12px] uppercase tracking-[0.05em] text-muted">
            You solved {assignment.progress} of {total}.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block text-[12px] uppercase tracking-[0.06em] text-rust hover:underline underline-offset-2"
          >
            ← Back to dashboard
          </Link>
        </div>
      </AssignmentHeader>
    );
  }

  // Resume or freshly issued: load the puzzle to reconstruct the board FEN.
  const puzzle = await db.puzzle.findUniqueOrThrow({ where: { id: issued.puzzleId } });
  // For a resumed attempt, rehydrate at the cursor; for a fresh one, startFen.
  const attempt = await db.attempt.findUniqueOrThrow({ where: { id: issued.attemptId } });
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
    <AssignmentHeader title={assignment.version.set.title} progress={assignment.progress} total={total}>
      <div className="flex justify-between items-center">
        <div>
          <p className="text-[12px] uppercase tracking-[0.05em] text-muted">
            Rating {puzzle.rating}
            {puzzle.themes.length > 0 && ` · ${puzzle.themes.join(", ")}`}
            {attempt.isReplay && (
              <span className="ml-2 text-warning">· replay (no coins)</span>
            )}
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-[12px] uppercase tracking-[0.06em] text-rust hover:underline underline-offset-2"
        >
          ← Back
        </Link>
      </div>

      <PuzzleBoard
        attemptId={attempt.id}
        startFen={fen}
        solutionLength={puzzle.solutionMoves.length}
        initialRevision={attempt.revision}
        coinBalance={balanceRow.coinBalance}
        usedHint={attempt.usedHint}
        hintMove={attempt.hintMove}
      />
    </AssignmentHeader>
  );
}

function AssignmentHeader({
  title,
  progress,
  total,
  children,
}: {
  title: string;
  progress: number;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="font-serif text-xl tracking-tight">{title}</h1>
          <p className="mt-1 text-[12px] uppercase tracking-[0.05em] text-muted">
            Progress {progress}/{total}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}
