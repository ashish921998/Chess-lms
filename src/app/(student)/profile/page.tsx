import Link from "next/link";
import { db } from "@/lib/db";
import { requireStudent } from "@/lib/auth-guards";
import { badgeLabel } from "@/lib/gamification/badges";
import { currentStreak } from "@/lib/gamification/streaks";
import { localDateFor } from "@/lib/gamification/dates";
import { TimezoneSelect } from "./timezone-select";

export const dynamic = "force-dynamic";

/**
 * /profile — Layout B (split identity + dark stats + badges).
 *
 * Left --panel: Lichess connection + timezone. Right --ink dark panel: stats
 * (one dark card per group per DESIGN.md). Full-width --panel below: badges.
 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ lichess?: string; lichess_error?: string }>;
}) {
  const me = await requireStudent();
  const params = await searchParams;

  const student = await db.student.findUniqueOrThrow({
    where: { id: me.id },
    include: {
      lichess: true,
      badges: { orderBy: { awardedAt: "desc" } },
    },
  });

  const streak = await currentStreak(db, me.id, localDateFor(new Date(), student.timezone));

  return (
    <div className="space-y-8">
      <h1 className="font-serif text-3xl tracking-tight">Profile</h1>

      {/* Identity + timezone (left) + dark stats (right). */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Left: Lichess + timezone. */}
        <section className="border border-line bg-panel p-6 space-y-6">
          <div>
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted2">Lichess</h2>
            <div className="mt-3">
              {student.lichess ? (
                <div className="space-y-3">
                  <p className="text-[13px] text-success">
                    ✓ Connected as {student.lichess.lichessUsername}
                  </p>
                  <dl className="grid grid-cols-1 gap-2 text-[12px]">
                    <div className="flex justify-between">
                      <dt className="text-muted">Puzzle rating</dt>
                      <dd className="font-mono text-ink">{student.lichessPuzzleRating ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">Game rating</dt>
                      <dd className="font-mono text-ink">{student.lichessGameRating ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">Last synced</dt>
                      <dd className="font-mono text-ink">
                        {student.lichess.lastSyncedAt
                          ? new Date(student.lichess.lastSyncedAt).toLocaleDateString()
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <a
                  href="/api/auth/lichess/start"
                  className="inline-block bg-ink text-paper px-4 py-2 text-[11px] font-medium uppercase tracking-[0.07em] hover:bg-[#3a3630]"
                >
                  Connect Lichess
                </a>
              )}
            </div>
          </div>
          <TimezoneSelect current={student.timezone} />
        </section>

        {/* Right: dark stats panel. */}
        <section className="border border-ink bg-ink text-paper p-6">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#b3ab9c]">Stats</h2>
          <dl className="mt-4 grid grid-cols-2 gap-y-5">
            <Stat label="Rating" value={student.inAppRating} accent />
            <Stat label="Coins" value={student.coinBalance} accent />
            <Stat label="Streak" value={`${streak}d`} />
            <Stat label="Daily goal" value={`${student.dailyGoal}`} />
          </dl>
        </section>
      </div>

      {params.lichess === "connected" && (
        <p className="border border-line bg-panel px-3 py-2 text-[13px] text-success">
          Lichess account connected! Your rating has been synced.
        </p>
      )}
      {params.lichess_error && (
        <p className="border border-line bg-panel px-3 py-2 text-[13px] text-error">
          Failed to connect: {decodeURIComponent(params.lichess_error)}
        </p>
      )}

      {/* Badges — full-width below. */}
      <section className="border border-line bg-panel p-6">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted2">
          Badges · {student.badges.length} earned
        </h2>
        {student.badges.length === 0 ? (
          <p className="mt-4 text-[13px] text-muted">No badges yet — keep solving.</p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {student.badges.map((b, i) => (
              <li
                key={b.id}
                className={`px-3 py-1 text-[10px] uppercase tracking-[0.08em] ${
                  i === 0
                    ? "border border-rust text-rust"
                    : "border border-line text-muted2"
                }`}
              >
                {badgeLabel(b.badgeKey)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link
        href="/dashboard"
        className="text-[12px] uppercase tracking-[0.06em] text-rust hover:underline underline-offset-2"
      >
        ← Back to dashboard
      </Link>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.1em] text-[#b3ab9c]">{label}</dt>
      <dd className={`font-serif text-3xl mt-1 ${accent ? "text-rust" : "text-paper"}`}>{value}</dd>
    </div>
  );
}
