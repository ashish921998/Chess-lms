import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTutorActor } from "@/lib/auth-guards";
import { createInviteTx, generateCode } from "@/lib/tutor/invites";

/**
 * POST /api/tutor/invites — generate a fresh invite code for the acting tutor.
 *
 * Body (all optional):
 *   { maxUses?: number (default 1), expiresAt?: ISO string | null }
 *
 * The code is crypto-random. Because `code` is @unique, a vanishingly rare
 * collision surfaces as Prisma P2002; we retry with a fresh code a few times.
 */
const MAX_CODE_ATTEMPTS = 5;

export async function POST(req: NextRequest) {
  const tutor = await getTutorActor();
  if (!tutor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const maxUses =
    body.maxUses === undefined || body.maxUses === null ? undefined : Number(body.maxUses);
  const expiresAt =
    body.expiresAt === undefined || body.expiresAt === null
      ? null
      : new Date(String(body.expiresAt));

  if (Number.isFinite(maxUses) && (maxUses as number) < 1) {
    return NextResponse.json({ error: "maxUses must be at least 1" }, { status: 400 });
  }
  if (expiresAt !== null && Number.isNaN(expiresAt.getTime())) {
    return NextResponse.json({ error: "expiresAt is not a valid date" }, { status: 400 });
  }

  let lastError: unknown;
  for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
    const code = generateCode();
    try {
      const invite = await db.$transaction((tx) =>
        createInviteTx(tx, tutor.id, { code, maxUses, expiresAt })
      );
      return NextResponse.json(invite, { status: 201 });
    } catch (e) {
      lastError = e;
      // Retry only on unique-constraint collision; everything else propagates.
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw lastError;
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "P2002"
  );
}
