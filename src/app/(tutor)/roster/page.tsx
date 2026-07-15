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
  const activeAssignmentCount = activeGroups.reduce((total, group) => total + group._count._all, 0);
  const studentsWithActivity = students.filter((student) => student.attempts[0]).length;

  const invites: InviteView[] = inviteRows.map((i) => ({
    id: i.id,
    code: i.code,
    uses: i.uses,
    maxUses: i.maxUses,
    expiresAt: i.expiresAt ? i.expiresAt.toISOString() : null,
    createdAt: i.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-9">
      <div className="page-heading">
        <div>
          <div className="page-kicker">Tutor overview</div>
          <h1>Your students</h1>
          <p>See progress at a glance, spot students who have gone quiet, and jump straight into the next coaching action.</p>
        </div>
        <Link href="/assign" className="primary-action">Assign homework <span aria-hidden="true">→</span></Link>
      </div>

      <section className="grid grid-cols-3 overflow-hidden surface-card">
        <RosterStat value={students.length} label="Students" />
        <RosterStat value={activeAssignmentCount} label="Active assignments" />
        <RosterStat value={studentsWithActivity} label="With activity" accent />
      </section>

      <InviteCodes invites={invites} />

      {students.length === 0 ? (
        <div className="surface-card px-5 py-12 text-center"><div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-shade text-xl">♙</div><h2 className="font-serif text-xl">Your roster is ready for its first student</h2><p className="mt-2 text-[13px] text-muted">Generate an invite code above and share it with your class.</p></div>
      ) : (
        <section>
          <div className="section-title"><h2>Roster</h2><span>Sorted alphabetically</span></div>
          <ul className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {students.map((s) => {
            const active = activeCountByStudent.get(s.id) ?? 0;
            const lastActive = s.attempts[0]?.createdAt;
            return (
              <li key={s.id} className="surface-card p-5">
                <div className="flex items-start gap-3">
                  <div className="app-avatar h-10 w-10 text-base">{s.displayName.charAt(0).toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link
                      href={`/students/${s.id}`}
                      className="font-serif text-xl tracking-tight hover:text-rust"
                    >
                      {s.displayName}
                    </Link>
                    <span className="rounded-full bg-shade px-2 py-1 text-[9px] font-bold text-muted">{s.inAppRating} rating</span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted">{lastActive ? `Last active ${formatRelative(lastActive)}` : "No practice activity yet"}</p>
                  </div>
                  <Link href={`/students/${s.id}`} className="secondary-action shrink-0">View</Link>
                </div>

                <div className="mt-5 border-t border-line/70 pt-4">
                  <div className="mb-2 flex items-center justify-between text-[10px]"><span className="font-bold uppercase tracking-[.08em] text-muted">Assignments</span><span className={active ? "text-warning" : "text-muted"}>{active ? `${active} active` : "All clear"}</span></div>
                  {s.assignments.length > 0 ? <div className="space-y-2">{s.assignments.slice(0, 2).map((a) => {
                    const total = versionTotal(a.version);
                    const percent = Math.min(100, Math.round((a.progress / Math.max(total, 1)) * 100));
                    return <div key={a.id} className="grid grid-cols-[1fr_auto] items-center gap-3"><div><div className="flex justify-between gap-3 text-[11px]"><span className="truncate">{a.version.set.title}</span><span className="text-muted">{a.progress}/{total}</span></div><div className="mt-1 h-1 overflow-hidden rounded-full bg-shade"><div className={a.completed ? "h-full bg-success" : "h-full bg-rust"} style={{ width: `${percent}%` }} /></div></div>{a.completed && <span className="text-[10px] text-success">✓</span>}</div>;
                  })}</div> : <p className="text-[11px] text-muted">No assignments yet.</p>}
                </div>
              </li>
            );
          })}
          </ul>
        </section>
      )}
    </div>
  );
}

function RosterStat({ value, label, accent = false }: { value: number; label: string; accent?: boolean }) {
  return <div className="border-r border-line/70 p-4 sm:p-5 last:border-r-0"><strong className={`block font-serif text-2xl sm:text-3xl ${accent ? "text-rust" : ""}`}>{value}</strong><span className="mt-1 block text-[8px] sm:text-[9px] font-bold uppercase tracking-[.08em] text-muted">{label}</span></div>;
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
