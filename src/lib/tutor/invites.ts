import { randomBytes } from "node:crypto";
import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";

/**
 * Tutor invite-code transactional logic. Mirrors the `sets` lib: each function
 * takes an injected `tx` so it composes inside a route handler's transaction
 * (and a test's rollback tx). All access is scoped by `tutorId`.
 *
 * Codes are crypto-random, human-readable (uppercase, no ambiguous chars), and
 * unique via a retry loop on P2002 at the route layer (see POST route).
 */

// 9 chars from an unambiguous alphabet (~36 bits of entropy, ~1e9 codes).
// Excludes 0/O/I/1 to avoid transcription errors. The chunked form (XXX-XXX-XXX)
// is what students type; the stored value is the un-hyphenated form.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 9;

/**
 * Generate a single random code (un-hyphenated). Exported for tests so the
 * retry loop can be exercised without hitting the DB.
 */
export function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/** Format a stored code as the hyphenated form a student types: XXX-XXX-XXX. */
export function formatCode(code: string): string {
  return code.replace(/^(.{3})(.{3})(.{3})$/, "$1-$2-$3");
}

/**
 * Create an invite code owned by `tutorId`. `maxUses` defaults to 1
 * (single-use) — a multi-use code is a deliberate choice by the tutor.
 */
export async function createInviteTx(
  tx: PrismaTransaction,
  tutorId: string,
  input: { code: string; maxUses?: number; expiresAt?: Date | null }
): Promise<{ id: string; code: string; maxUses: number; expiresAt: Date | null }> {
  const maxUses = input.maxUses ?? 1;
  if (maxUses < 1) throw new ValidationError("maxUses must be at least 1");

  return tx.inviteCode.create({
    data: {
      tutorId,
      code: input.code,
      maxUses,
      expiresAt: input.expiresAt ?? null,
    },
    select: { id: true, code: true, maxUses: true, expiresAt: true },
  });
}

/**
 * Revoke (delete) an invite code. Scoped by tutorId: a code owned by another
 * tutor looks like "not found" here (returns false), never an existence leak.
 */
export async function revokeInviteTx(
  tx: PrismaTransaction,
  tutorId: string,
  codeId: string
): Promise<boolean> {
  const result = await tx.inviteCode.deleteMany({
    where: { id: codeId, tutorId },
  });
  return result.count > 0;
}

export class ValidationError extends Error {}
