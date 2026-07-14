import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";

/**
 * The coin ledger — the single seam every CoinTransaction write flows through.
 *
 * Coins move for six reasons (mirrors the `CoinReason` enum). Earns bump the
 * student's balance; spends are debited conditionally by the caller first (to
 * enforce sufficiency) and only record their ledger row here. Both share one
 * idempotency contract: `idempotencyKey` is unique, so a duplicate write is a
 * no-op — replays never double-credit or double-charge.
 */
export type LedgerReason =
  | "SOLVE"
  | "SOLVE_HINTED"
  | "GOAL_BONUS"
  | "STREAK_BONUS"
  | "PURCHASE_HINT"
  | "PURCHASE_SKIP";

export type LedgerEntry = {
  studentId: string;
  /** Signed amount: positive = earn, negative = spend. */
  amount: number;
  reason: LedgerReason;
  /** Business key — a second write with the same key is a no-op. */
  idempotencyKey: string;
  /** attemptId / assignmentId, when the movement traces to one. */
  refId?: string | null;
};

/**
 * Write one idempotent ledger row. Returns true iff a NEW row was inserted
 * (false when the idempotencyKey already existed). Does NOT touch the student's
 * balance — spends debit their balance conditionally themselves; earns that
 * should bump the balance use `creditLedger`.
 */
export async function writeLedgerRow(
  tx: PrismaTransaction,
  entry: LedgerEntry
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "CoinTransaction" (id, "studentId", amount, reason, "idempotencyKey", "refId", "createdAt")
    VALUES (gen_random_uuid(), ${entry.studentId}, ${entry.amount}, ${entry.reason}, ${entry.idempotencyKey}, ${entry.refId ?? null}, NOW())
    ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Earn coins: write the ledger row and, only if it was newly written, increment
 * the student's balance and lifetime total in the same transaction. Returns
 * true iff coins were credited (false on idempotency-key replay).
 */
export async function creditLedger(
  tx: PrismaTransaction,
  entry: LedgerEntry
): Promise<boolean> {
  const credited = await writeLedgerRow(tx, entry);
  if (credited) {
    await tx.student.update({
      where: { id: entry.studentId },
      data: {
        coinBalance: { increment: entry.amount },
        lifetimeCoins: { increment: entry.amount },
      },
    });
  }
  return credited;
}
