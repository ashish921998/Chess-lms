import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";
import { STREAK_TIERS } from "@/lib/economy";
import { creditLedger } from "@/lib/ledger";

/**
 * Current streak: consecutive goal-met days ending today (or yesterday if today
 * isn't met yet). `todayLocal` is the student's local date from localDateFor().
 *
 * If today's row exists and is goal-met, the chain starts at today. Otherwise we
 * count back from yesterday — an unbroken streak isn't shown as broken just
 * because the student hasn't solved yet today; it breaks only when a day is
 * *missed*. (gate #10.)
 *
 * Implemented as an iterative TS walk over a small row set (≤ a 30-day streak's
 * ~30 rows) — clearer than a recursive CTE, and the row count is tiny.
 */
export async function currentStreak(
  tx: PrismaTransaction,
  studentId: string,
  todayLocal: Date
): Promise<number> {
  // Pull goal-met days from today back through a generous window. We need
  // enough to confirm a 30-day streak with a gap somewhere, so 40 is ample.
  const rows = await tx.dailyProgress.findMany({
    where: {
      studentId,
      date: { lte: todayLocal },
    },
    orderBy: { date: "desc" },
    take: 40,
    select: { date: true, goalMet: true },
  });

  // Determine the starting day: today if met, else yesterday.
  const todayKey = todayLocal.toISOString().slice(0, 10);
  const todayRow = rows.find(
    (r) => r.date.toISOString().slice(0, 10) === todayKey
  );

  let cursor: Date;
  if (todayRow && todayRow.goalMet) {
    cursor = todayLocal;
  } else {
    // Start from yesterday. If yesterday has no row or isn't met, streak is 0.
    cursor = addDays(todayLocal, -1);
  }

  // Walk backward day-by-day while rows are present and goal-met.
  let streak = 0;
  for (let d = cursor; ; d = addDays(d, -1)) {
    const key = d.toISOString().slice(0, 10);
    const row = rows.find((r) => r.date.toISOString().slice(0, 10) === key);
    if (row && row.goalMet) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Award any newly-crossed streak-tier bonuses. Idempotent: each tier credits at
 * most once via an `ON CONFLICT (idempotencyKey) DO NOTHING RETURNING` ledger
 * row keyed `streak:{studentId}:{days}`. Called from recordSolve step 6 with
 * the freshly-computed streak.
 */
export async function awardStreakBonusesTx(
  tx: PrismaTransaction,
  studentId: string,
  streak: number
): Promise<void> {
  for (const tier of STREAK_TIERS) {
    if (streak < tier.days) continue;
    await creditLedger(tx, {
      studentId,
      amount: tier.bonus,
      reason: "STREAK_BONUS",
      idempotencyKey: `streak:${studentId}:${tier.days}`,
    });
  }
}

/** Add whole days to a date-only Date (midnight-UTC keys). */
function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
