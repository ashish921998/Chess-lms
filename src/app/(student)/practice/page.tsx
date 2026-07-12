import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireStudent } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

/**
 * /practice — M1: redirect to the lowest-rated unsolved puzzle.
 * M2 will replace this with the auto-queue selection logic.
 */
export default async function PracticeIndex() {
  const me = await requireStudent();

  // Find puzzles the student hasn't solved yet, pick the lowest-rated.
  const solvedPuzzleIds = await db.studentPuzzle.findMany({
    where: { studentId: me.id },
    select: { puzzleId: true },
  });
  const solvedIds = solvedPuzzleIds.map((s) => s.puzzleId);

  const next = await db.puzzle.findFirst({
    where: { id: { notIn: solvedIds.length > 0 ? solvedIds : undefined } },
    orderBy: { rating: "asc" },
  });

  if (!next) {
    // All puzzles solved — go to dashboard.
    redirect("/dashboard");
  }

  redirect(`/practice/${next.id}`);
}
