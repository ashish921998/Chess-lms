import Link from "next/link";
import { requireTutor } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { versionTotal } from "@/lib/puzzles/version-total";

export const dynamic = "force-dynamic";

/**
 * Roster-lite (the tutor landing). One row per student: name, rating,
 * last-active, and a per-student assignment summary. Per the spec, the per-
 * assignment progress shows "solved/total items" for MANUAL and
 * "progress/targetCount, completed?" for FILTER. Defer /students/[id] to M4.
 */
export default async function RosterPage() {
  const tutor = await requireTutor();

  const students = await db.student.findMany({
    where: { tutorId: tutor.id },
    orderBy: { displayName: "asc" },
    include: {
      assignments: {
        orderBy: { createdAt: "desc" },
        take: 5,
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
      },
      attempts: {
        where: { status: { in: ["SOLVED", "FAILED"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Roster</h1>
          <p className="text-sm text-slate-500">{students.length} students</p>
        </div>
      </div>

      {students.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-slate-500">
          No students yet. Students join with your invite code.
        </div>
      ) : (
        <ul className="space-y-3">
          {students.map((s) => (
            <li key={s.id} className="rounded-lg border bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{s.displayName}</span>
                  <span className="ml-3 text-sm text-slate-500">Rating {s.inAppRating}</span>
                </div>
                <span className="text-sm text-slate-500">
                  {s.attempts[0]
                    ? `Active ${formatRelative(s.attempts[0].createdAt)}`
                    : "No activity"}
                </span>
              </div>

              {s.assignments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {s.assignments.map((a) => (
                    <span
                      key={a.id}
                      className={`text-xs px-2 py-1 rounded ${
                        a.completed
                          ? "bg-green-50 text-green-700"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {a.version.set.title}: {a.progress}/{versionTotal(a.version)}
                      {a.completed && " ✓"}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatRelative(date: Date): string {
  const ms = Date.now() - date.getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}
