import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTutorActor } from "@/lib/auth-guards";
import { revokeInviteTx } from "@/lib/tutor/invites";

/**
 * DELETE /api/tutor/invites/[codeId] — revoke an invite code.
 *
 * The deleteMany is scoped by both `codeId` AND `tutorId`, so a code owned by
 * another tutor returns 404 (no existence leak). Returns 200 regardless of
 * whether a row was actually deleted, so the client just refreshes the list.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ codeId: string }> }
) {
  const tutor = await getTutorActor();
  if (!tutor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { codeId } = await params;

  const revoked = await db.$transaction((tx) => revokeInviteTx(tx, tutor.id, codeId));
  if (!revoked) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
