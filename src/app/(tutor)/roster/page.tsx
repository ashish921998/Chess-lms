import Link from "next/link";
import { requireTutor } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { versionTotal } from "@/lib/puzzles/version-total";
import { InviteCodes, type InviteView } from "./invite-codes";

export const dynamic = "force-dynamic";

/**
 * Roster (the tutor landing). One card per student: name (a link to the
 * per-student detail page), rating, active-assignment count, last-active, and
 * recent assignment chips. Hosts the invite-code panel (the only join path).
 */
export default async function RosterPage() {
  const tutor = await requireTutor();

  const [students, inviteRows] = await Promise.all([
    db.student.findMany({
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
    }),
    db.inviteCode.findMany({
      where: { tutorId: tutor.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, code: true, uses: true, maxUses: true, expiresAt: true, createdAt: true },
    }),
  ]);

  // Active (uncompleted) assignment count per student — the "active count".
  // `take: 5` on the include above prevents deriving it from the included set.
  const activeGroups = await db.assignment.groupBy({
    by: ["studentId"],
    where: { student: { tutorId: tutor.id }, completed: false },
    _count: { _all: true },
  });
  const activeCountByStudent = new Map(
    activeGroups.map((g) => [g.studentId, g._count._all])
  );

  const invites: InviteView[] = inviteRows.map((i) => ({
    id: i.id,
    code: i.code,
    uses: i.uses,
    maxUses: i.maxUses,
    expiresAt: i.expiresAt ? i.expiresAt.toISOString() : null,
    createdAt: i.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl tracking-tight">Roster</h1>
        <p className="mt-1 text-[12px] uppercase tracking-[0.05em] text-muted">
          {students.length} students
        </p>
      </div>

      <InviteCodes invites={invites} />

      {students.length === 0 ? (
        <p className="border border-line bg-panel px-4 py-8 text-center text-[13px] text-muted">
          No students yet. Generate an invite code above and share it.
        </p>
      ) : (
        <ul className="space-y-3">
          {students.map((s) => {
            const active = activeCountByStudent.get(s.id);
            return (
              <li key={s.id} className="border border-line bg-panel p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-3">
                    <Link
                      href={`/students/${s.id}`}
                      className="font-serif text-lg tracking-tight hover:text-rust"
                    >
                      {s.displayName}
                    </Link>
                    <span className="text-[12px] uppercase tracking-[0.05em] text-muted">
                      Rating <span className="text-rust">{s.inAppRating}</span>
                    </span>
                    {active ? (
                      <span className="text-[10px] uppercase tracking-[0.06em] border border-warning text-warning px-2 py-0.5">
                        {active} active
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[12px] uppercase tracking-[0.05em] text-muted">
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
                        className={`text-[10px] uppercase tracking-[0.06em] px-2 py-1 border ${
                          a.completed
                            ? "border-success/40 text-success"
                            : "border-line text-muted"
                        }`}
                      >
                        {a.version.set.title}: {a.progress}/{versionTotal(a.version)}
                        {a.completed && " ✓"}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
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
