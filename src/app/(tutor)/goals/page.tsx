import { requireTutor } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { GoalsEditor, type GoalRow } from "./goals-editor";

export const dynamic = "force-dynamic";

/**
 * /goals — daily-goal management. Roster table with inline-editable dailyGoal
 * per student, plus a "set all to N" control. Edits PATCH /api/tutor/goals.
 */
export default async function GoalsPage() {
  const tutor = await requireTutor();

  const students = await db.student.findMany({
    where: { tutorId: tutor.id },
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, dailyGoal: true },
  });

  const rows: GoalRow[] = students.map((s) => ({
    id: s.id,
    displayName: s.displayName,
    dailyGoal: s.dailyGoal,
  }));

  return (
    <div className="space-y-9">
      <div className="page-heading"><div><div className="page-kicker">Training consistency</div>
        <h1>Daily goals</h1>
        <p>
          Set each student&apos;s daily puzzle goal
        </p></div></div>

      {rows.length === 0 ? (
        <p className="border border-line bg-panel px-4 py-8 text-center text-[13px] text-muted">
          No students yet — add some from the roster first.
        </p>
      ) : (
        <GoalsEditor rows={rows} />
      )}
    </div>
  );
}
