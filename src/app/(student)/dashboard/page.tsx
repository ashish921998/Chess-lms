import Link from "next/link";
import { db } from "@/lib/db";
import { requireStudent } from "@/lib/auth-guards";
import { versionTotal } from "@/lib/puzzles/version-total";
import { currentStreak } from "@/lib/gamification/streaks";
import { localDateFor } from "@/lib/gamification/dates";
import { formatInTimeZone } from "date-fns-tz";
import { puzzleTitle, humanizeTheme } from "@/lib/puzzles/labels";
import { BoardPreview } from "@/components/chess/board-preview";

export const dynamic = "force-dynamic";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ queue?: string }>;
}) {
  const me = await requireStudent();
  const params = await searchParams;
  const student = await db.student.findUniqueOrThrow({
    where: { id: me.id },
    include: {
      attempts: {
        where: { status: { in: ["SOLVED", "FAILED"] } },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { puzzle: true },
      },
    },
  });

  const solvedCount = await db.attempt.count({
    where: { studentId: me.id, status: "SOLVED" },
  });

  // Streak + today's solve count (timezone-correct local date).
  const todayLocal = localDateFor(new Date(), student.timezone);
  const streak = await currentStreak(db, me.id, todayLocal);
  const todayProgress = await db.dailyProgress.findUnique({
    where: { studentId_date: { studentId: me.id, date: todayLocal } },
  });
  const solvedToday = todayProgress?.solvedCount ?? 0;
  const goalMet = solvedToday >= student.dailyGoal;

  // Puzzles available for practice (M1: all seeded puzzles, no rating filtering yet).
  const availablePuzzles = await db.puzzle.findMany({
    orderBy: { rating: "asc" },
    take: 10,
  });

  // Active assignments for the assignments section. MANUAL shows solved/total
  // items; FILTER shows progress/targetCount. Uncompleted first, then by due date.
  const assignments = await db.assignment.findMany({
    where: { studentId: me.id },
    orderBy: [{ completed: "asc" }, { dueDate: "asc" }],
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

  // Replay solves per assignment: SOLVED attempts serving this assignment where
  // the puzzle was already globally solved (isReplay). Surfaced as
  // "Completed — N replays" so the student understands low coin gain on FILTER
  // assignments (spec §FILTER replay UX).
  const replayGroups = await db.attempt.groupBy({
    by: ["assignmentId"],
    where: {
      studentId: me.id,
      status: "SOLVED",
      isReplay: true,
      assignmentId: { not: null },
    },
    _count: { _all: true },
  });
  const replayCountByAssignment = new Map(
    replayGroups
      .filter((g) => g.assignmentId !== null)
      .map((g) => [g.assignmentId as string, g._count._all])
  );
  const goalPercent = Math.min(100, Math.round((solvedToday / Math.max(student.dailyGoal, 1)) * 100));
  const activeAssignments = assignments.filter((assignment) => !assignment.completed);

  return (
    <div className="space-y-9">
      <div className="page-heading">
        <div>
          <div className="page-kicker">Your training room</div>
          <h1>Good {daypart(student.timezone)}, {student.displayName}</h1>
          <p>{goalMet ? "Daily goal complete. Keep the momentum going or review an assignment." : `${student.dailyGoal - solvedToday} more puzzle${student.dailyGoal - solvedToday === 1 ? "" : "s"} to reach today's goal.`}</p>
        </div>
        <Link href="/practice" className="primary-action">Start practice <span aria-hidden="true">→</span></Link>
      </div>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="surface-card p-5 sm:p-7 flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="goal-ring" style={{ background: `conic-gradient(var(--rust) ${goalPercent}%, #e1dbcf ${goalPercent}% 100%)` }}>
            <div><strong>{solvedToday}</strong><span>of {student.dailyGoal}</span></div>
          </div>
          <div className="flex-1">
            <div className="page-kicker mb-2">Today&apos;s goal</div>
            <h2 className="font-serif text-2xl tracking-tight">{goalMet ? "Nicely done — goal reached." : "Build consistency, one position at a time."}</h2>
            <p className="mt-2 max-w-xl text-[13px] leading-6 text-muted">Your daily target keeps training focused and protects your streak. Practice picks the best available puzzle for your rating.</p>
          </div>
        </div>
        <div className="grid grid-cols-3 overflow-hidden surface-card">
          <StatCard label="Rating" value={student.inAppRating} />
          <StatCard label="Streak" value={`${streak}d`} accent />
          <StatCard label="Coins" value={student.coinBalance} />
        </div>
      </section>

      {params.queue === "complete" && (
        <p className="surface-card border-warning/40 px-4 py-3 text-[13px] leading-6 text-warning">You&apos;ve completed every puzzle currently available in your rating range. Review an assignment now, then check back later.</p>
      )}

      {assignments.length > 0 && (
        <section>
          <div className="section-title"><h2>Assignments</h2><span>{activeAssignments.length} active</span></div>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {assignments.map((a) => {
              const total = versionTotal(a.version);
              const replays = replayCountByAssignment.get(a.id);
              const cta = a.completed
                ? "Review"
                : a.progress > 0
                ? "Continue"
                : "Start";
              const overdue = !a.completed && a.dueDate && a.dueDate < new Date();
              const progress = Math.min(100, Math.round((a.progress / Math.max(total, 1)) * 100));
              return (
                <li key={a.id} className="surface-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-serif text-xl tracking-tight">{a.version.set.title}</div>
                      <div className="mt-1 text-[11px] text-muted">{a.version.mode === "FILTER" ? "Adaptive set" : "Curated set"}{replays ? ` · ${replays} replay${replays === 1 ? "" : "s"}` : ""}</div>
                    </div>
                    {a.dueDate && (
                      <div className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${overdue ? "bg-error/10 text-error" : "bg-shade text-muted"}`}>
                        {overdue ? "Overdue" : `Due ${a.dueDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
                      </div>
                    )}
                  </div>
                  <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-shade"><div className="h-full rounded-full bg-rust" style={{ width: `${progress}%` }} /></div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[11px] text-muted">{a.progress} of {total} complete</span>
                    <Link href={`/sets/${a.id}`} className="secondary-action">{cta} →</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <div className="section-title"><h2>Explore puzzles</h2><Link href="/practice">Smart queue →</Link></div>
        <div className="surface-card overflow-hidden">
          <ul className="divide-y divide-line/70">
            {availablePuzzles.slice(0, 5).map((p) => (
              <li key={p.id} className="flex items-center gap-4 px-4 py-3 sm:px-5">
                <div className="shrink-0"><BoardPreview fen={p.startFen} maxWidth={52} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><strong className="text-[12px]">{puzzleTitle(p.themes)}</strong><span className="rounded-full bg-shade px-2 py-0.5 text-[9px] font-bold text-muted">{p.rating}</span></div>
                  <div className="mt-1 truncate text-[11px] text-muted">{p.themes.slice(0, 3).map(humanizeTheme).join(" · ") || "Tactical training"}</div>
                </div>
                <Link href={`/practice/${p.id}`} className="secondary-action shrink-0">Solve</Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {student.attempts.length > 0 && (
        <section>
          <div className="section-title"><h2>Recent activity</h2><span>{solvedCount} solved overall</span></div>
          <ul className="surface-card divide-y divide-line/70 overflow-hidden">
            {student.attempts.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-5 py-3.5 text-[12px]">
                <span><strong>{puzzleTitle(a.puzzle.themes)}</strong><span className="ml-2 text-muted">Rating {a.puzzle.rating}</span></span>
                <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${a.status === "SOLVED" ? "bg-success/10 text-success" : "bg-error/10 text-error"}`}>{a.status === "SOLVED" ? "Solved" : "Try again"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, accent = false }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="flex min-h-32 flex-col justify-center border-r border-line/70 p-4 last:border-r-0">
      <div className={`font-serif text-3xl tracking-tight ${accent ? "text-rust" : ""}`}>{value}</div>
      <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.1em] text-muted">{label}</div>
    </div>
  );
}

function daypart(tz: string) {
  // Student-local hour, matching the timezone used for streaks/daily progress.
  const hour = Number(formatInTimeZone(new Date(), tz, "H"));
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
