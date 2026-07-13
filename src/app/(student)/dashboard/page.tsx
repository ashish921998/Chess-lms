import Link from "next/link";
import { db } from "@/lib/db";
import { requireStudent } from "@/lib/auth-guards";
import { signOut as signOutClient } from "@/lib/auth-client";
import { versionTotal } from "@/lib/puzzles/version-total";
import { SignOutButton } from "./sign-out-button";

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

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Welcome, {student.displayName}</h1>
          <p className="text-slate-500">
            Rating {student.inAppRating} · {solvedCount} solved · {student.coinBalance} coins
          </p>
        </div>
        <SignOutButton />
      </div>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Current Rating" value={student.inAppRating} />
        <StatCard label="Coins" value={student.coinBalance} />
        <StatCard label="Solved" value={solvedCount} />
      </section>

      {params.queue === "complete" && (
        <p className="text-amber-700 text-sm bg-amber-50 rounded px-3 py-2">
          You've solved all available puzzles in your rating range! Try again later —
          new puzzles may be added, or your rating may shift the window.
        </p>
      )}

      {assignments.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Assignments</h2>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {assignments.map((a) => {
              const total = versionTotal(a.version);
              const cta = a.completed
                ? "Review"
                : a.progress > 0
                ? "Continue"
                : "Start";
              return (
                <li key={a.id} className="rounded-lg border bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{a.version.set.title}</div>
                      <div className="text-sm text-slate-500 mt-0.5">
                        {a.progress}/{total}{" "}
                        {a.version.mode === "FILTER" ? "solved" : "puzzles"}
                        {a.completed && <span className="text-green-700"> · done</span>}
                      </div>
                    </div>
                    {a.dueDate && (
                      <div
                        className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${
                          !a.completed && a.dueDate < new Date()
                            ? "bg-red-50 text-red-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        due {a.dueDate.toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <Link
                    href={`/sets/${a.id}`}
                    className="mt-3 inline-block text-sm text-blue-600 hover:underline"
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
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-semibold">Puzzles</h2>
          <Link
            href="/practice"
            className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded hover:bg-slate-800"
          >
            Start daily practice →
          </Link>
        </div>
        <ul className="divide-y rounded-lg border bg-white">
          {availablePuzzles.map((p) => (
            <li key={p.id} className="flex justify-between items-center p-4">
              <div>
                <span className="font-mono text-sm text-slate-500">{p.id}</span>
                <span className="ml-3 inline-block bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded">
                  {p.rating}
                </span>
                {p.themes.map((t) => (
                  <span
                    key={t}
                    className="ml-2 inline-block bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <Link
                href={`/practice/${p.id}`}
                className="text-blue-600 text-sm hover:underline"
              >
                Solve →
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {student.attempts.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Recent activity</h2>
          <ul className="divide-y rounded-lg border bg-white">
            {student.attempts.map((a) => (
              <li key={a.id} className="flex justify-between p-3 text-sm">
                <span className="font-mono text-slate-500">{a.puzzle.id}</span>
                <span
                  className={
                    a.status === "SOLVED"
                      ? "text-green-700 font-medium"
                      : "text-red-700"
                  }
                >
                  {a.status === "SOLVED" ? "✓ Solved" : "✗ Failed"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
