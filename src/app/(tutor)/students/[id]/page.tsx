import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTutor } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { versionTotal } from "@/lib/puzzles/version-total";
import { currentStreak } from "@/lib/gamification/streaks";
import { localDateFor } from "@/lib/gamification/dates";
import { themeAccuracy } from "@/lib/tutor/student-analytics";
import { RatingTrend } from "./rating-trend";

export const dynamic = "force-dynamic";

/**
 * /students/[id] — the tutor's per-student deep-teaching view. Reached from the
 * roster; notFound() if the student isn't the acting tutor's (no existence
 * leak). Four sections: stat strip, rating trend, theme accuracy, solve
 * history + assignment progress.
 */
export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const tutor = await requireTutor();
  const { id: studentId } = await params;

  const student = await db.student.findUnique({
    where: { id: studentId },
    include: {
      ratingEvents: { orderBy: { createdAt: "asc" }, take: 100, select: { rating: true, createdAt: true } },
    },
  });
  // Cross-tutor guard: 404 (no existence leak).
  if (!student || student.tutorId !== tutor.id) notFound();

  const solvedCount = await db.attempt.count({
    where: { studentId, status: "SOLVED" },
  });
  const streak = await currentStreak(db, studentId, localDateFor(new Date(), student.timezone));
  const themes = await themeAccuracy(db, studentId);

  const [recentAttempts, assignments] = await Promise.all([
    db.attempt.findMany({
      where: { studentId, status: { in: ["SOLVED", "FAILED"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, puzzleId: true, status: true, createdAt: true },
    }),
    db.assignment.findMany({
      where: { studentId },
      orderBy: { createdAt: "desc" },
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
    }),
  ]);
  const replayGroups = await db.attempt.groupBy({
    by: ["assignmentId"],
    where: { studentId, status: "SOLVED", isReplay: true, assignmentId: { not: null } },
    _count: { _all: true },
  });
  const replaysByAssignment = new Map(
    replayGroups.filter((g) => g.assignmentId).map((g) => [g.assignmentId as string, g._count._all])
  );

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/roster"
          className="text-[12px] uppercase tracking-[0.06em] text-rust hover:underline underline-offset-2"
        >
          ← Roster
        </Link>
        <div className="mt-2 flex items-baseline gap-4 flex-wrap">
          <h1 className="font-serif text-3xl tracking-tight">{student.displayName}</h1>
          <span className="text-[12px] uppercase tracking-[0.05em] text-muted">
            Rating <span className="text-rust">{student.inAppRating}</span> · {streak}d streak · {solvedCount} solved · {student.coinBalance} coins
          </span>
        </div>
      </div>

      {/* Rating trend */}
      <section className="border border-line bg-panel p-6">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted2 mb-4">Rating trend</h2>
        {student.ratingEvents.length < 2 ? (
          <p className="text-[13px] text-muted">Not enough rated attempts yet to show a trend.</p>
        ) : (
          <RatingTrend events={student.ratingEvents} />
        )}
      </section>

      {/* Theme accuracy */}
      <section className="border border-line bg-panel">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted2 px-6 pt-5">Theme accuracy</h2>
        {themes.length === 0 ? (
          <p className="px-6 py-5 text-[13px] text-muted">No attempts yet.</p>
        ) : (
          <div>
            <div className="grid grid-cols-[1fr_7rem_5rem] gap-4 px-6 py-2 text-[10px] uppercase tracking-[0.1em] text-muted border-b border-line">
              <div>Theme</div>
              <div className="text-right">Solved/Attempted</div>
              <div className="text-right">Accuracy</div>
            </div>
            <ul className="divide-y divide-line">
              {themes.map((t) => (
                <li key={t.theme} className="grid grid-cols-[1fr_7rem_5rem] gap-4 px-6 py-2.5 items-center">
                  <div className="text-[13px]">{t.theme}</div>
                  <div className="text-right font-mono text-[13px] text-muted2">
                    {t.solved}/{t.attempted}
                  </div>
                  <div className="text-right font-mono text-[13px] text-rust">{t.accuracy}%</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Solve history */}
      <section className="border border-line bg-panel">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted2 px-6 pt-5">Solve history</h2>
        {recentAttempts.length === 0 ? (
          <p className="px-6 py-5 text-[13px] text-muted">No attempts yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {recentAttempts.map((a) => (
              <li key={a.id} className="grid grid-cols-[1fr_auto] gap-4 px-6 py-2.5 items-center">
                <span className="font-mono text-[13px] text-muted2">{a.puzzleId}</span>
                <span className="flex items-center gap-3">
                  <span className={`text-[12px] uppercase tracking-[0.06em] ${a.status === "SOLVED" ? "text-success" : "text-error"}`}>
                    {a.status === "SOLVED" ? "✓ Solved" : "✕ Failed"}
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.05em] text-muted2">
                    {a.createdAt.toLocaleDateString()}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Assignment progress */}
      <section className="border border-line bg-panel">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted2 px-6 pt-5">Assignments</h2>
        {assignments.length === 0 ? (
          <p className="px-6 py-5 text-[13px] text-muted">No assignments yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {assignments.map((a) => {
              const total = versionTotal(a.version);
              const replays = replaysByAssignment.get(a.id);
              return (
                <li key={a.id} className="grid grid-cols-[1fr_auto] gap-4 px-6 py-3 items-center">
                  <div>
                    <div className="font-serif text-[15px]">{a.version.set.title}</div>
                    <div className="mt-0.5 text-[11px] uppercase tracking-[0.05em] text-muted">
                      {a.progress}/{total}
                      {a.completed && <span className="text-success"> · done</span>}
                      {replays ? <span className="text-muted2"> · {replays} replays</span> : null}
                    </div>
                  </div>
                  <span
                    className={`text-[10px] uppercase tracking-[0.06em] px-2 py-1 border ${
                      a.completed
                        ? "border-success/40 text-success"
                        : "border-line text-muted"
                    }`}
                  >
                    {a.completed ? "Completed" : "Active"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
