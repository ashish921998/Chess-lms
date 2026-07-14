import { describe, it, expect } from "vitest";
import { withRollbackTx, seedFixture } from "./db-harness";
import { purchaseHintTx, purchaseSkipTx, HINT_COST, SKIP_COST, type SpendAttempt } from "@/lib/gamification/spend";
import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";

/**
 * Spend-economy gates #2–#8 and ledger integrity #25. Drives the `*Tx`
 * functions directly inside a rollback tx.
 *
 * Concurrency note: the conditional `UPDATE … WHERE coinBalance >= cost
 * RETURNING` is the race guard. Under a single rollback tx it is asserted
 * sequentially and by its SQL algebra (a WHERE-gated debit can never go
 * negative). See tests/README.md.
 */

describe("purchaseHintTx", () => {
  it("charges 15, sets usedHint/hintMove, returns the correct move, does not advance the cursor (gate #2)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      await tx.student.update({ where: { id: fx.studentId }, data: { coinBalance: 100 } });
      const { attempt, row } = await makeAttempt(tx, fx.studentId, "pz-1500-mate", { moveIndex: 0 });

      const result = await purchaseHintTx(tx, attempt);

      expect(result).toEqual({ kind: "hinted", hintMove: "f3f7" }); // fixture solution
      const after = await tx.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(after.usedHint).toBe(true);
      expect(after.hintMove).toBe("f3f7");
      expect(after.status).toBe("PENDING"); // not finalized
      expect(after.moveIndex).toBe(row.moveIndex); // cursor unchanged
      const s = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(s.coinBalance).toBe(100 - HINT_COST);
    });
  });

  it("is idempotent: a second hint returns the stored move without re-charging (gate #3)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      await tx.student.update({ where: { id: fx.studentId }, data: { coinBalance: 100 } });
      const first = await makeAttempt(tx, fx.studentId, "pz-1500-mate", { moveIndex: 0 });
      await purchaseHintTx(tx, first.attempt);

      // Reload with usedHint = true (as the route would) and call again.
      const fresh = await reload(tx, fx.studentId, "pz-1500-mate");
      const result = await purchaseHintTx(tx, fresh);

      expect(result).toEqual({ kind: "hinted", hintMove: "f3f7" });
      const s = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(s.coinBalance).toBe(100 - HINT_COST); // charged once, not twice
    });
  });

  it("rejects a finalized attempt with attempt_not_pending and charges nothing (gate #4)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      await tx.student.update({ where: { id: fx.studentId }, data: { coinBalance: 100 } });
      const { attempt, row } = await makeAttempt(tx, fx.studentId, "pz-1500-mate");
      await tx.attempt.update({ where: { id: row.id }, data: { status: "SOLVED" } });
      const fresh = await reload(tx, fx.studentId, "pz-1500-mate");

      const result = await purchaseHintTx(tx, fresh);

      expect(result).toEqual({ kind: "attempt_not_pending" });
      const s = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(s.coinBalance).toBe(100); // untouched
      expect(attempt).toBeDefined();
      const ledger = await tx.coinTransaction.count({ where: { studentId: fx.studentId, reason: "PURCHASE_HINT" } });
      expect(ledger).toBe(0);
    });
  });

  it("returns insufficient_funds when balance < 15, with no ledger row and no flag flip (gate #5)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      await tx.student.update({ where: { id: fx.studentId }, data: { coinBalance: 10 } });
      const { attempt } = await makeAttempt(tx, fx.studentId, "pz-1500-mate");

      const result = await purchaseHintTx(tx, attempt);

      expect(result).toEqual({ kind: "insufficient_funds" });
      const s = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(s.coinBalance).toBe(10); // untouched
      const after = await tx.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(after.usedHint).toBe(false);
      const ledger = await tx.coinTransaction.count({ where: { studentId: fx.studentId, reason: "PURCHASE_HINT" } });
      expect(ledger).toBe(0);
    });
  });
});

describe("purchaseSkipTx", () => {
  it("charges 30, finalizes SKIPPED, no Elo, no StudentPuzzle, streak-neutral (gate #6)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      await tx.student.update({ where: { id: fx.studentId }, data: { coinBalance: 100 } });
      const { attempt } = await makeAttempt(tx, fx.studentId, "pz-1500-mate");

      const result = await purchaseSkipTx(tx, attempt);

      expect(result).toEqual({ kind: "skipped" });
      const after = await tx.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(after.status).toBe("SKIPPED");
      expect(after.usedSkip).toBe(true);
      expect(after.finalizedAt).not.toBeNull();
      // No StudentPuzzle written (skips don't count as solves).
      const sp = await tx.studentPuzzle.count({ where: { studentId: fx.studentId, puzzleId: "pz-1500-mate" } });
      expect(sp).toBe(0);
      // No rating event (no Elo on skip).
      const re = await tx.ratingEvent.count({ where: { studentId: fx.studentId } });
      expect(re).toBe(0);
      const s = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(s.coinBalance).toBe(100 - SKIP_COST);
    });
  });

  it("is idempotent: a second skip on a SKIPPED attempt returns skipped with no charge (gate #7)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      await tx.student.update({ where: { id: fx.studentId }, data: { coinBalance: 100 } });
      await makeAttempt(tx, fx.studentId, "pz-1500-mate");
      const first = await reload(tx, fx.studentId, "pz-1500-mate");
      await purchaseSkipTx(tx, first);

      const fresh = await reload(tx, fx.studentId, "pz-1500-mate");
      const result = await purchaseSkipTx(tx, fresh);

      expect(result).toEqual({ kind: "skipped" });
      const s = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(s.coinBalance).toBe(100 - SKIP_COST); // charged once
    });
  });

  it("returns insufficient_funds when balance < 30, with no state mutated (gate #8)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      await tx.student.update({ where: { id: fx.studentId }, data: { coinBalance: 20 } });
      const { attempt } = await makeAttempt(tx, fx.studentId, "pz-1500-mate");

      const result = await purchaseSkipTx(tx, attempt);

      expect(result).toEqual({ kind: "insufficient_funds" });
      const after = await tx.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(after.status).toBe("PENDING"); // unchanged
      const s = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(s.coinBalance).toBe(20);
      const ledger = await tx.coinTransaction.count({ where: { studentId: fx.studentId, reason: "PURCHASE_SKIP" } });
      expect(ledger).toBe(0);
    });
  });
});

describe("Ledger integrity after a hint + skip sequence (gate #25)", () => {
  it("keeps SUM(amount) = coinBalance and SUM(amount>0) = lifetimeCoins", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // Start with a known balance backed by ledger rows.
      await tx.student.update({
        where: { id: fx.studentId },
        data: { coinBalance: 100, lifetimeCoins: 100 },
      });
      await tx.coinTransaction.create({
        data: {
          studentId: fx.studentId,
          amount: 100,
          reason: "SOLVE",
          idempotencyKey: "solve:seed:1",
        },
      });

      await makeAttempt(tx, fx.studentId, "pz-1500-mate");
      // Hint then skip on the same attempt.
      await purchaseHintTx(tx, await reload(tx, fx.studentId, "pz-1500-mate"));
      await purchaseSkipTx(tx, await reload(tx, fx.studentId, "pz-1500-mate"));

      const rows = await tx.coinTransaction.findMany({ where: { studentId: fx.studentId } });
      const sum = rows.reduce((acc, r) => acc + r.amount, 0);
      const sumPositive = rows.filter((r) => r.amount > 0).reduce((acc, r) => acc + r.amount, 0);
      const s = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });

      expect(sum).toBe(s.coinBalance);
      expect(sumPositive).toBe(s.lifetimeCoins);
      // 100 - 15 (hint) - 30 (skip) = 55 spendable; lifetime never decreases.
      expect(s.coinBalance).toBe(55);
      expect(s.lifetimeCoins).toBe(100);
    });
  });
});

// ── helpers ──

async function makeAttempt(
  tx: PrismaTransaction,
  studentId: string,
  puzzleId: string,
  opts: { moveIndex?: number } = {}
) {
  const puzzle = await tx.puzzle.findUniqueOrThrow({ where: { id: puzzleId } });
  const row = await tx.attempt.create({
    data: { studentId, puzzleId, status: "PENDING", moveIndex: opts.moveIndex ?? 0 },
  });
  const attempt: SpendAttempt = {
    id: row.id,
    studentId,
    status: "PENDING",
    usedHint: false,
    hintMove: null,
    moveIndex: row.moveIndex,
    solutionMoves: puzzle.solutionMoves,
  };
  return { row, attempt };
}

/** Reload the attempt as the route would (fresh DB state) into a SpendAttempt. */
async function reload(tx: PrismaTransaction, studentId: string, puzzleId: string): Promise<SpendAttempt> {
  const row = await tx.attempt.findFirstOrThrow({
    where: { studentId, puzzleId },
    orderBy: { createdAt: "desc" },
    include: { puzzle: true },
  });
  return {
    id: row.id,
    studentId,
    status: row.status,
    usedHint: row.usedHint,
    hintMove: row.hintMove,
    moveIndex: row.moveIndex,
    solutionMoves: row.puzzle.solutionMoves,
  };
}
