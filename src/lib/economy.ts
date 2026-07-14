/**
 * The coin economy — every way a student earns or spends coins, in one place.
 *
 * Pure constants, no imports, so this is safe to read from server logic, the
 * ledger, and the client puzzle board alike. If you're changing a reward or a
 * price, this is the only file that should move.
 */

/** Solve rewards (coins). A hinted solve earns less than a clean one. */
export const SOLVE_REWARD_NO_HINT = 10;
export const SOLVE_REWARD_HINTED = 5;

/** One-time bonus for meeting the daily goal. */
export const GOAL_BONUS = 50;

/** Spend costs (coins). */
export const HINT_COST = 15;
export const SKIP_COST = 30;

/** Streak-bonus thresholds and their one-time awards. */
export const STREAK_TIERS = [
  { days: 7, bonus: 100 },
  { days: 30, bonus: 250 },
] as const;
