import { describe, it, expect } from "vitest";
import { withRollbackTx, seedFixture } from "./db-harness";
import {
  createInviteTx,
  revokeInviteTx,
  generateCode,
  formatCode,
  ValidationError,
} from "@/lib/tutor/invites";

/**
 * DB integration tests for the tutor invite-code logic. Drives the lib
 * functions directly inside a rollback tx; the route handlers are thin
 * wrappers over these. Mirrors the tutor-sets test structure.
 */

describe("generateCode", () => {
  it("produces a 9-char code from the unambiguous alphabet", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateCode();
      expect(code).toHaveLength(9);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
    }
  });

  it("does not include ambiguous characters (0, O, I, 1)", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).not.toMatch(/[01OI]/);
    }
  });

  it("is highly unlikely to produce duplicates across many draws", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) codes.add(generateCode());
    // 9 chars from a 32-char alphabet → ~36 bits; 1000 draws should be unique.
    expect(codes.size).toBeGreaterThan(990);
  });
});

describe("formatCode", () => {
  it("hyphenates into XXX-XXX-XXX", () => {
    expect(formatCode("ABCDEFGHK")).toBe("ABC-DEF-GHK");
  });
});

describe("createInviteTx", () => {
  it("creates a single-use code owned by the tutor (defaults)", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const invite = await createInviteTx(tx, fx.tutorId, { code: "TESTCODE1" });

      expect(invite.code).toBe("TESTCODE1");
      expect(invite.maxUses).toBe(1);
      expect(invite.expiresAt).toBeNull();

      const row = await tx.inviteCode.findUnique({ where: { id: invite.id } });
      expect(row?.tutorId).toBe(fx.tutorId);
      expect(row?.uses).toBe(0);
    });
  });

  it("honours an explicit maxUses and expiresAt", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const later = new Date(Date.now() + 86_400_000);
      const invite = await createInviteTx(tx, fx.tutorId, {
        code: "MULTIUSE1",
        maxUses: 10,
        expiresAt: later,
      });

      expect(invite.maxUses).toBe(10);
      expect(invite.expiresAt?.toISOString()).toBe(later.toISOString());
    });
  });

  it("rejects maxUses < 1", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      await expect(
        createInviteTx(tx, fx.tutorId, { code: "BADMAXUS1", maxUses: 0 })
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});

describe("revokeInviteTx", () => {
  it("deletes the tutor's own code and returns true", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const invite = await createInviteTx(tx, fx.tutorId, { code: "REVOKEIT1" });

      const ok = await revokeInviteTx(tx, fx.tutorId, invite.id);
      expect(ok).toBe(true);

      const gone = await tx.inviteCode.findUnique({ where: { id: invite.id } });
      expect(gone).toBeNull();
    });
  });

  it("returns false (no leak) for another tutor's code", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const invite = await createInviteTx(tx, fx.tutorId, { code: "OWNEDBYT1" });

      // Attempt revoke as the OTHER tutor — should not delete, returns false.
      const ok = await revokeInviteTx(tx, fx.tutor2Id, invite.id);
      expect(ok).toBe(false);

      // The original code survives.
      const survives = await tx.inviteCode.findUnique({ where: { id: invite.id } });
      expect(survives?.tutorId).toBe(fx.tutorId);
    });
  });

  it("returns false for a non-existent code id", async () => {
    await withRollbackTx(async (tx) => {
      const fx = await seedFixture(tx);
      const ok = await revokeInviteTx(tx, fx.tutorId, "does-not-exist");
      expect(ok).toBe(false);
    });
  });
});
