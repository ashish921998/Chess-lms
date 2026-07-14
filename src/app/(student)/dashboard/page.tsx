import Link from "next/link";
import { db } from "@/lib/db";
import { requireStudent } from "@/lib/auth-guards";
import { versionTotal } from "@/lib/puzzles/version-total";
import { currentStreak } from "@/lib/gamification/streaks";
import { localDateFor } from "@/lib/gamification/dates";

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

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-serif text-3xl tracking-tight">Welcome, {student.displayName}</h1>
        <p className="mt-1 text-[12px] uppercase tracking-[0.05em] text-muted">
          Rating {student.inAppRating} · {solvedCount} solved · {student.coinBalance} coins
        </p>
        <p className="mt-1 text-[12px] uppercase tracking-[0.05em] text-muted">
          <span className={goalMet ? "text-rust" : ""}>
            {solvedToday}/{student.dailyGoal} today
          </span>
        </p>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <StatCard label="Current Rating" value={student.inAppRating} />
        <StatCard label="Coins" value={student.coinBalance} />
        <StatCard label="Streak" value={`${streak}d`} accent />
        <StatCard label="Solved" value={solvedCount} />
      </section>

      {params.queue === "complete" && (
        <p className="border border-line bg-panel px-3 py-2 text-[13px] text-warning">
          ◆ You&apos;ve solved all available puzzles in your rating range. Try again later —
          new puzzles may be added, or your rating may shift the window.
        </p>
      )}

      {assignments.length > 0 && (
        <section>
          <SectionLabel>Assignments</SectionLabel>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {assignments.map((a) => {
              const total = versionTotal(a.version);
              const replays = replayCountByAssignment.get(a.id);
              const cta = a.completed
                ? "Review"
                : a.progress > 0
                ? "Continue"
                : "Start";
              const overdue = !a.completed && a.dueDate && a.dueDate < new Date();
              return (
                <li key={a.id} className="border border-line bg-panel p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-serif text-lg">{a.version.set.title}</div>
                      <div className="mt-1 text-[12px] uppercase tracking-[0.05em] text-muted">
                        {a.progress}/{total}{" "}
                        {a.version.mode === "FILTER" ? "solved" : "puzzles"}
                        {a.completed && (
                          <span className="text-success">
                            {replays
                              ? ` · done (${replays} replay${replays === 1 ? "" : "s"})`
                              : " · done"}
                          </span>
                        )}
                      </div>
                    </div>
                    {a.dueDate && (
                      <div
                        className={`text-[10px] uppercase tracking-[0.06em] px-2 py-1 whitespace-nowrap border ${
                          overdue
                            ? "border-error text-error"
                            : "border-line text-muted"
                        }`}
                      >
                        due {a.dueDate.toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <Link
                    href={`/sets/${a.id}`}
                    className="mt-3 inline-block text-[12px] uppercase tracking-[0.06em] text-rust hover:underline underline-offset-2"
                  >
                    {cta} →
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <div className="flex justify-between items-center mb-4">
          <SectionLabel className="mb-0">Puzzles</SectionLabel>
          <Link
            href="/practice"
            className="bg-ink text-paper px-4 py-2 text-[11px] font-medium uppercase tracking-[0.07em] hover:bg-[#3a3630]"
          >
            Start daily practice →
          </Link>
        </div>
        <ul className="border border-line bg-panel divide-y divide-line">
          {availablePuzzles.map((p) => (
            <li key={p.id} className="flex justify-between items-center p-4">
              <div className="flex items-center gap-3">
                <span className="text-[13px] text-muted">{p.id}</span>
                <span className="border border-line text-muted text-[10px] uppercase tracking-[0.06em] px-2 py-0.5">
                  {p.rating}
                </span>
                {p.themes.map((t) => (
                  <span
                    key={t}
                    className="border border-line text-rust text-[10px] uppercase tracking-[0.06em] px-2 py-0.5"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <Link
                href={`/practice/${p.id}`}
                className="text-[12px] uppercase tracking-[0.06em] text-rust hover:underline underline-offset-2"
              >
                Solve →
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {student.attempts.length > 0 && (
        <section>
          <SectionLabel>Recent activity</SectionLabel>
          <ul className="border border-line bg-panel divide-y divide-line">
            {student.attempts.map((a) => (
              <li key={a.id} className="flex justify-between p-3 text-[13px]">
                <span className="text-muted">{a.puzzle.id}</span>
                <span className={a.status === "SOLVED" ? "text-success" : "text-error"}>
                  {a.status === "SOLVED" ? "✓ Solved" : "✕ Failed"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SectionLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2 className={`mb-4 text-[11px] font-medium uppercase tracking-[0.14em] text-muted2 ${className}`}>
      {children}
    </h2>
  );
}

function StatCard({ label, value, accent = false }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="border border-line bg-panel p-4">
      <div className="text-[10px] uppercase tracking-[0.1em] text-muted">{label}</div>
      <div className={`font-serif text-3xl mt-1 ${accent ? "text-rust" : ""}`}>{value}</div>
    </div>
  );
}
