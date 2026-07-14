import { describe, it, expect } from "vitest";
import { withRollbackTx, seedFixture } from "./db-harness";
import { sweepStaleAttemptsTx, applyLichessSyncTx, isCronAuthorized } from "@/lib/gamification/cron";

/**
 * Cron gates #22–#24. Sweep + auth are exercised directly; the Lichess
 * persistence half (applyLichessSyncTx) is tested without the network, and the
 * inAppRating-init-guard invariant is asserted.
 */

describe("sweepStaleAttemptsTx (gate #22)", () => {
  it("abandons PENDING attempts older than 2h; leaves newer PENDING and terminal untouched", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);

      // 3h old PENDING — should be swept.
      await tx.attempt.create({
        data: {
          studentId: fx.studentId,
          puzzleId: "pz-1500-mate",
          status: "PENDING",
          createdAt: new Date(Date.now() - 3 * 3600_000),
        },
      });
      // 30m old PENDING — should remain.
      await tx.attempt.create({
        data: {
          studentId: fx.studentId,
          puzzleId: "pz-1100-fork",
          status: "PENDING",
          createdAt: new Date(Date.now() - 30 * 60_000),
        },
      });
      // 3h old SOLVED (terminal) — should remain.
      await tx.attempt.create({
        data: {
          studentId: fx.studentId,
          puzzleId: "pz-1900-fork",
          status: "SOLVED",
          createdAt: new Date(Date.now() - 3 * 3600_000),
        },
      });

      const swept = await sweepStaleAttemptsTx(tx);
      expect(swept).toBe(1);

      const abandoned = await tx.attempt.count({
        where: { studentId: fx.studentId, status: "ABANDONED" },
      });
      expect(abandoned).toBe(1);
      const pending = await tx.attempt.count({
        where: { studentId: fx.studentId, status: "PENDING" },
      });
      expect(pending).toBe(1); // the 30m-old one
      const solved = await tx.attempt.count({
        where: { studentId: fx.studentId, status: "SOLVED" },
      });
      expect(solved).toBe(1); // untouched
    });
  });

  it("is idempotent: a second sweep finds nothing new", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      await tx.attempt.create({
        data: {
          studentId: fx.studentId,
          puzzleId: "pz-1500-mate",
          status: "PENDING",
          createdAt: new Date(Date.now() - 3 * 3600_000),
        },
      });
      await sweepStaleAttemptsTx(tx);
      const second = await sweepStaleAttemptsTx(tx);
      expect(second).toBe(0); // already abandoned
    });
  });
});

describe("applyLichessSyncTx (gate #23)", () => {
  it("updates lichess ratings + lastSyncedAt and never touches inAppRating", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      // Give the student a Lichess connection + a non-default inAppRating.
      await tx.lichessConnection.create({
        data: {
          studentId: fx.studentId,
          lichessId: "abc",
          lichessUsername: "testuser",
        },
      });
      await tx.student.update({
        where: { id: fx.studentId },
        data: { inAppRating: 1600, lichessPuzzleRating: 1800 },
      });

      await applyLichessSyncTx(tx, { studentId: fx.studentId, username: "testuser" }, {
        puzzle: { rating: 1900 },
        rapid: { rating: 1750 },
      });

      const s = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(s.lichessPuzzleRating).toBe(1900);
      expect(s.lichessGameRating).toBe(1750);
      expect(s.inAppRating).toBe(1600); // untouched — init guard holds
      const conn = await tx.lichessConnection.findUniqueOrThrow({ where: { studentId: fx.studentId } });
      expect(conn.lastSyncedAt).not.toBeNull();
    });
  });

  it("falls back to blitz when rapid is absent", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      await tx.lichessConnection.create({
        data: { studentId: fx.studentId, lichessId: "abc", lichessUsername: "u" },
      });
      await applyLichessSyncTx(tx, { studentId: fx.studentId, username: "u" }, {
        blitz: { rating: 2000 },
      });
      const s = await tx.student.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(s.lichessGameRating).toBe(2000);
    });
  });
});

describe("isCronAuthorized (gate #24)", () => {
  it("rejects missing, wrong, and unset-CRON_SECRET requests", () => {
    const realSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-secret";

    try {
      expect(isCronAuthorized(null)).toBe(false);
      expect(isCronAuthorized("Bearer wrong")).toBe(false);
      expect(isCronAuthorized("Bearer test-secret")).toBe(true);
      expect(isCronAuthorized("test-secret")).toBe(false); // missing Bearer prefix
    } finally {
      if (realSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = realSecret;
    }
  });

  it("rejects all when CRON_SECRET is unset", () => {
    const realSecret = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      expect(isCronAuthorized("Bearer anything")).toBe(false);
    } finally {
      if (realSecret !== undefined) process.env.CRON_SECRET = realSecret;
    }
  });
});
