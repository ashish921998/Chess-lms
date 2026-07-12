import { redirect } from "next/navigation";
import { requireStudent } from "@/lib/auth-guards";
import { selectNextPuzzle } from "@/lib/puzzles/selection";

export const dynamic = "force-dynamic";

/**
 * /practice — auto-queue entry point. Selects a level-appropriate puzzle
 * based on the student's inAppRating and redirects to the solver.
 * If the queue is exhausted, redirects to the dashboard with a message.
 */
export default async function PracticeIndex() {
  const me = await requireStudent();

  const puzzle = await selectNextPuzzle(me.id);

  if (!puzzle) {
    redirect("/dashboard?queue=complete");
  }

  redirect(`/practice/${puzzle.id}`);
}
