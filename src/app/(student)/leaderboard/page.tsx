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
    <div className="space-y-9">
      <div className="page-heading">
        <div><div className="page-kicker">Class standings</div><h1>Leaderboard</h1><p>Earn coins through consistent, accurate practice. Rankings use lifetime coins, then solved puzzles as the tie-breaker.</p></div>
      </div>

      {board.length === 0 ? (
        <p className="surface-card px-4 py-12 text-center text-[13px] text-muted">
          No rankings yet — solve some puzzles to appear here.
        </p>
      ) : (
        <div className="surface-card overflow-hidden">
          {/* Header row — uppercase mono, muted. */}
          <div className="grid grid-cols-[3rem_1fr_4rem_4rem] gap-3 border-b border-line bg-shade/40 px-4 py-3 text-[9px] font-bold uppercase tracking-[0.1em] text-muted sm:grid-cols-[4rem_1fr_6rem_6rem] sm:px-5">
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
                  className={`grid grid-cols-[3rem_1fr_4rem_4rem] gap-3 px-4 py-4 items-center sm:grid-cols-[4rem_1fr_6rem_6rem] sm:px-5 ${
                    you ? "bg-rust/5" : ""
                  }`}
                >
                  <div className={`font-serif text-xl ${i < 3 ? "text-rust" : "text-muted2"}`}>{i + 1}</div>
                  <div className="text-[12px] sm:text-[13px] flex items-center gap-2 min-w-0">
                    <span className="truncate font-semibold">{row.displayName}</span>
                    {you && (
                      <span className="rounded-full bg-rust px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] text-white">
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
