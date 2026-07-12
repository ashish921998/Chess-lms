import Link from "next/link";
import { db } from "@/lib/db";
import { requireStudent } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ lichess?: string; lichess_error?: string }>;
}) {
  const me = await requireStudent();
  const params = await searchParams;

  const student = await db.student.findUniqueOrThrow({
    where: { id: me.id },
    include: { lichess: true },
  });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Profile</h1>

      <section className="rounded-lg border bg-white p-6 space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold">Lichess Connection</h2>
            <p className="text-sm text-slate-500">
              Link your Lichess account to calibrate puzzles to your rating.
            </p>
          </div>
          {student.lichess ? (
            <span className="text-green-700 text-sm font-medium bg-green-50 px-3 py-1.5 rounded">
              ✓ Connected as {student.lichess.lichessUsername}
            </span>
          ) : (
            <a
              href="/api/auth/lichess/start"
              className="bg-slate-900 text-white text-sm px-4 py-2 rounded hover:bg-slate-800"
            >
              Connect Lichess
            </a>
          )}
        </div>

        {params.lichess === "connected" && (
          <p className="text-green-700 text-sm bg-green-50 rounded px-3 py-2">
            Lichess account connected! Your rating has been synced.
          </p>
        )}
        {params.lichess_error && (
          <p className="text-red-700 text-sm bg-red-50 rounded px-3 py-2">
            Failed to connect: {decodeURIComponent(params.lichess_error)}
          </p>
        )}

        {student.lichess && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-slate-500">Lichess puzzle rating:</span>{" "}
              <span className="font-medium">{student.lichessPuzzleRating ?? "—"}</span>
            </div>
            <div>
              <span className="text-slate-500">Lichess game rating:</span>{" "}
              <span className="font-medium">{student.lichessGameRating ?? "—"}</span>
            </div>
            <div>
              <span className="text-slate-500">Last synced:</span>{" "}
              <span className="font-medium">
                {student.lichess.lastSyncedAt
                  ? new Date(student.lichess.lastSyncedAt).toLocaleString()
                  : "—"}
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-white p-6 space-y-3">
        <h2 className="text-lg font-semibold">Stats</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Stat label="In-app rating" value={student.inAppRating} />
          <Stat label="Coins" value={student.coinBalance} />
          <Stat label="Lifetime coins" value={student.lifetimeCoins} />
          <Stat label="Daily goal" value={`${student.dailyGoal} puzzles`} />
        </div>
      </section>

      <Link href="/dashboard" className="text-blue-600 hover:underline">
        ← Back to dashboard
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-slate-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
