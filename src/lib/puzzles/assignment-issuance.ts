import type { PrismaTransaction } from "./transaction-client";
import { selectNextPuzzle, type SelectedPuzzle } from "./selection";

/**
 * Assignment puzzle issuance — run inside the student solver page's
 * (or `/api/attempts`') issuance transaction. Both modes return the puzzle to
 * serve plus the linking IDs the PENDING `Attempt` needs:
 *   - MANUAL → `assignmentItemId` set (the item being served).
 *   - FILTER → `assignmentItemId = null` (the marker `finalizeSolved` forks on).
 *
 * The page owns the `FOR UPDATE` student lock + resume/abandon-of-other-PENDING
 * prelude (spec §Issuance); these helpers only derive the next puzzle.
 */

/** True iff the student has solved `puzzleId` anywhere (a `StudentPuzzle` row). */
async function isPuzzleReplay(
  tx: PrismaTransaction,
  studentId: string,
  puzzleId: string
): Promise<boolean> {
  return !!(await tx.studentPuzzle.findUnique({
    where: { studentId_puzzleId: { studentId, puzzleId } },
    select: { puzzleId: true },
  }));
}

export type IssueResult =
  | { kind: "MANUAL"; puzzle: SelectedPuzzle; assignmentItemId: string; isReplay: boolean }
  | { kind: "FILTER"; puzzle: SelectedPuzzle; assignmentItemId: null; isReplay: boolean }
  | { kind: "COMPLETE" };

/**
 * MANUAL issuance: the lowest-`order` unsolved `AssignmentItemProgress` row for
 * the assignment. Returns `{ kind: "COMPLETE" }` when no unsolved item remains.
 *
 * `isReplay` is true iff the student has a `StudentPuzzle` row for the puzzle
 * (solved it before, anywhere) — replays award no coins/Elo but still count.
 */
export async function pickManualItem(
  tx: PrismaTransaction,
  assignmentId: string,
  studentId: string
): Promise<IssueResult> {
  const item = await tx.assignmentItemProgress.findFirst({
    where: { assignmentId, solved: false },
    orderBy: { order: "asc" },
  });
  if (!item) return { kind: "COMPLETE" };

  const puzzle = await tx.puzzle.findUniqueOrThrow({ where: { id: item.puzzleId } });

  return {
    kind: "MANUAL",
    puzzle: {
      id: puzzle.id,
      rating: puzzle.rating,
      themes: puzzle.themes,
      startFen: puzzle.startFen,
    },
    assignmentItemId: item.id,
    isReplay: await isPuzzleReplay(tx, studentId, puzzle.id),
  };
}

/**
 * FILTER issuance: run the generalized selection against the assignment's
 * frozen version criteria, with assignment-scoped anti-repeat. Returns
 * `{ kind: "COMPLETE" }` when the filter range is exhausted before `targetCount`.
 */
export async function selectFilterPuzzle(
  tx: PrismaTransaction,
  assignmentId: string,
  studentId: string
): Promise<IssueResult> {
  const assignment = await tx.assignment.findUniqueOrThrow({
    where: { id: assignmentId },
    include: {
      version: {
        select: {
          mode: true,
          filterThemes: true,
          filterRatingMin: true,
          filterRatingMax: true,
          targetCount: true,
        },
      },
    },
  });
  if (assignment.completed) return { kind: "COMPLETE" };

  const puzzle = await selectNextPuzzle(
    studentId,
    {
      filter: {
        themes: assignment.version.filterThemes,
        ratingMin: assignment.version.filterRatingMin,
        ratingMax: assignment.version.filterRatingMax,
      },
      assignmentId,
    },
    tx
  );
  if (!puzzle) return { kind: "COMPLETE" };

  return {
    kind: "FILTER",
    puzzle,
    assignmentItemId: null,
    isReplay: await isPuzzleReplay(tx, studentId, puzzle.id),
  };
}
