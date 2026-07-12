import Link from "next/link";
import { db } from "@/lib/db";
import { requireStudent } from "@/lib/auth-guards";
import { signOut as signOutClient } from "@/lib/auth-client";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const me = await requireStudent();
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
