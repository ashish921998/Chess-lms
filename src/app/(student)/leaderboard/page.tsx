import { db } from "@/lib/db";
import { requireStudent } from "@/lib/auth-guards";
import { classLeaderboard } from "@/lib/gamification/leaderboard";

export const dynamic = "force-dynamic";

/**
 * /leaderboard — class ranking. Bare ranking per spec: lifetimeCoins DESC,
 * tie-broken by solvedCount DESC then id ASC. Display names only. The session
 * student's own row is highlighted so they find themselves fast.
 */
export default async function LeaderboardPage() {
  const me = await requireStudent();
  const board = await classLeaderboard(db, me.tutorId);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl tracking-tight">Leaderboard</h1>
        <p className="mt-1 text-[12px] uppercase tracking-[0.05em] text-muted">
          Ranked by lifetime coins
        </p>
      </div>

      {board.length === 0 ? (
        <p className="border border-line bg-panel px-4 py-8 text-center text-[13px] text-muted">
          No rankings yet — solve some puzzles to appear here.
        </p>
      ) : (
        <div className="border border-line bg-panel">
          {/* Header row — uppercase mono, muted. */}
          <div className="grid grid-cols-[3rem_1fr_5rem_5rem] gap-4 px-4 py-2 text-[10px] uppercase tracking-[0.1em] text-muted border-b border-line">
            <div>Rank</div>
            <div>Name</div>
            <div className="text-right">Coins</div>
            <div className="text-right">Solved</div>
          </div>
          <ul className="divide-y divide-line">
            {board.map((row, i) => {
              const you = row.id === me.id;
              return (
                <li
                  key={row.id}
                  className={`grid grid-cols-[3rem_1fr_5rem_5rem] gap-4 px-4 py-3 items-center ${
                    you ? "bg-paper" : ""
                  }`}
                >
                  <div className="font-mono text-[13px] text-muted2">{i + 1}</div>
                  <div className="text-[13px] flex items-center gap-2">
                    <span className={you ? "text-ink" : "text-ink"}>{row.displayName}</span>
                    {you && (
                      <span className="text-[9px] uppercase tracking-[0.1em] text-rust border border-rust px-1.5 py-0.5">
                        You
                      </span>
                    )}
                  </div>
                  <div className="text-right font-mono text-[13px] text-rust">{row.lifetimeCoins}</div>
                  <div className="text-right font-mono text-[13px] text-muted2">{row.solvedCount}</div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
