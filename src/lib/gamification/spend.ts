import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";
import { writeLedgerRow } from "@/lib/ledger";
import { HINT_COST, SKIP_COST } from "@/lib/economy";

/** Re-exported from the economy so existing importers keep their import path. */
export { HINT_COST, SKIP_COST };

/** Result codes the spend routes translate to HTTP statuses. */
export type HintResult =
  | { kind: "hinted"; hintMove: string }
  | { kind: "attempt_not_pending" }
  | { kind: "insufficient_funds" };

export type SkipResult =
  | { kind: "skipped" }
  | { kind: "attempt_not_pending" }
  | { kind: "insufficient_funds" };

/**
 * The attempt fields a spend needs. The route loads the attempt (+puzzle for the
 * hint's solution move) and passes this in. Shaped like FinalizeAttempt so the
 * spend functions compose inside the same rollback transaction as finalize.
 */
export type SpendAttempt = {
  id: string;
  studentId: string;
  status: string;
  usedHint: boolean;
  hintMove: string | null;
  moveIndex: number;
  /** The full solution plies — the hint reveals the next one owed. */
  solutionMoves: string[];
};

/**
 * Reveal the best move (hint) for 15 coins. One hint per attempt.
 *
 * Guards (spec §1b):
 *  1. status != PENDING → attempt_not_pending (no charge).
 *  2. usedHint already true → return the stored hintMove (idempotent, no charge).
 *  3. Conditional debit: UPDATE Student SET coinBalance = coinBalance - 15
 *     WHERE id AND coinBalance >= 15 RETURNING. Zero rows → insufficient_funds;
 *     the transaction rolls back and NO state is mutated (no ledger, no flag).
 *  4. Ledger row via ON CONFLICT (idempotencyKey) DO NOTHING RETURNING — a retry
 *     after a partial success does not re-charge, but step 5 is idempotent so the
 *     flag/move are still set.
 *  5. Set usedHint + hintMove. The cursor does NOT advance — the student must
 *     still play the revealed move.
 */
export async function purchaseHintTx(
  tx: PrismaTransaction,
  attempt: SpendAttempt
): Promise<HintResult> {
  // 1. Not pending — finalized or abandoned. No charge.
  if (attempt.status !== "PENDING") {
    return { kind: "attempt_not_pending" };
  }

  // 2. Already hinted — return the stored move (idempotent).
  if (attempt.usedHint) {
    return { kind: "hinted", hintMove: attempt.hintMove! };
  }

  // 3. Conditional balance debit. Zero rows = insufficient funds; rollback.
  const debited = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Student" SET "coinBalance" = "coinBalance" - ${HINT_COST}
    WHERE id = ${attempt.studentId} AND "coinBalance" >= ${HINT_COST}
    RETURNING id
  `;
  if (debited.length === 0) {
    return { kind: "insufficient_funds" };
  }

  // 4. Ledger row — ON CONFLICT makes a retry non-recharging. The balance was
  //    already debited conditionally in step 3, so this only records the row.
  const credited = await writeLedgerRow(tx, {
    studentId: attempt.studentId,
    amount: -HINT_COST,
    reason: "PURCHASE_HINT",
    idempotencyKey: `hint:${attempt.id}`,
    refId: attempt.id,
  });

  // 5. Flip the flag + store the revealed move. Guarded by status = 'PENDING'
  //    RETURNING — if the race was lost (a concurrent finalize/skip flipped the
  //    status between the debit and here), throw to roll back the whole tx so no
  //    coins leave the balance. The cursor stays put.
  const hintMove = attempt.solutionMoves[attempt.moveIndex];
  const flipped = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Attempt" SET "usedHint" = true, "hintMove" = ${hintMove}
    WHERE id = ${attempt.id} AND status = 'PENDING' RETURNING id
  `;
  if (flipped.length === 0 && credited) {
    throw new Error("__race_lost__");
  }

  return { kind: "hinted", hintMove };
}

/**
 * Skip the current puzzle for 30 coins. Finalizes as SKIPPED — no Elo, no
 * StudentPuzzle, streak-neutral.
 *
 * Guards (spec §1b):
 *  1. status = SKIPPED → idempotent { skipped } (no charge). Any other
 *     non-PENDING → attempt_not_pending.
 *  2. Conditional debit (same pattern as hint, cost 30).
 *  3. Ledger row via ON CONFLICT DO NOTHING.
 *  4. Finalize: flip PENDING → SKIPPED in the same tx (guarded by status).
 */
export async function purchaseSkipTx(
  tx: PrismaTransaction,
  attempt: SpendAttempt
): Promise<SkipResult> {
  // 1. Idempotent on an already-skipped attempt; reject other terminal states.
  if (attempt.status === "SKIPPED") {
    return { kind: "skipped" };
  }
  if (attempt.status !== "PENDING") {
    return { kind: "attempt_not_pending" };
  }

  // 2. Conditional balance debit.
  const debited = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Student" SET "coinBalance" = "coinBalance" - ${SKIP_COST}
    WHERE id = ${attempt.studentId} AND "coinBalance" >= ${SKIP_COST}
    RETURNING id
  `;
  if (debited.length === 0) {
    return { kind: "insufficient_funds" };
  }

  // 3. Ledger row — the balance was already debited conditionally in step 2.
  const credited = await writeLedgerRow(tx, {
    studentId: attempt.studentId,
    amount: -SKIP_COST,
    reason: "PURCHASE_SKIP",
    idempotencyKey: `skip:${attempt.id}`,
    refId: attempt.id,
  });

  // 4. Finalize as SKIPPED — guarded by status = 'PENDING' RETURNING. If the
  //    race was lost (a concurrent finalize flipped the status between the debit
  //    and here), throw to roll back the charge so no partial state survives
  //    (no coins spent on an attempt that wasn't skipped).
  const flipped = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Attempt" SET status = 'SKIPPED', "usedSkip" = true, "finalizedAt" = NOW()
    WHERE id = ${attempt.id} AND status = 'PENDING' RETURNING id
  `;
  if (flipped.length === 0 && credited) {
    throw new Error("__race_lost__");
  }

  return { kind: "skipped" };
}
