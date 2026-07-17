import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTutorActor } from "@/lib/auth-guards";
import { isDeveloperEmail } from "@/lib/developer";

/**
 * PATCH /api/tutor/feedback/[id]
 *   - status:  developer-only (triage the request)
 *   - devNote: developer-only (reply / resolution note)
 *   - body:    author-only (edit own comment)
 *
 * DELETE /api/tutor/feedback/[id]
 *   - author may delete their own; developer may delete any.
 */
const VALID_STATUSES = new Set(["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "DONE", "WONTFIX"]);
const TERMINAL = new Set(["DONE", "WONTFIX"]);
const MAX_BODY = 4000;
const MAX_DEV_NOTE = 4000;

async function resolveActor() {
  const tutor = await getTutorActor();
  if (!tutor) return null;
  const user = await db.user.findUnique({
    where: { id: tutor.userId },
    select: { email: true },
  });
  const developer = isDeveloperEmail(user?.email);
  return { tutor, developer };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await resolveActor();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { tutor, developer } = actor;
  const { id } = await params;

  const existing = await db.tutorFeedback.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const data: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (!developer) {
      return NextResponse.json({ error: "Only the developer can change status" }, { status: 403 });
    }
    if (typeof body.status !== "string" || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    data.status = body.status;
    data.resolvedAt = TERMINAL.has(body.status as string)
      ? existing.resolvedAt ?? new Date()
      : null;
  }

  if (body.devNote !== undefined) {
    if (!developer) {
      return NextResponse.json({ error: "Only the developer can set a dev note" }, { status: 403 });
    }
    const note = typeof body.devNote === "string" ? body.devNote.trim().slice(0, MAX_DEV_NOTE) : "";
    data.devNote = note || null;
  }

  if (body.body !== undefined) {
    if (existing.tutorId !== tutor.id) {
      return NextResponse.json({ error: "You can only edit your own comment" }, { status: 403 });
    }
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!text) return NextResponse.json({ error: "Comment cannot be empty" }, { status: 400 });
    if (text.length > MAX_BODY) {
      return NextResponse.json({ error: `Comment too long (max ${MAX_BODY} chars)` }, { status: 400 });
    }
    data.body = text;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await db.tutorFeedback.update({ where: { id }, data });
  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    body: updated.body,
    devNote: updated.devNote,
    resolvedAt: updated.resolvedAt ? updated.resolvedAt.toISOString() : null,
    updatedAt: updated.updatedAt.toISOString(),
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await resolveActor();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { tutor, developer } = actor;
  const { id } = await params;

  const existing = await db.tutorFeedback.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!developer && existing.tutorId !== tutor.id) {
    return NextResponse.json({ error: "You can only delete your own comment" }, { status: 403 });
  }

  await db.tutorFeedback.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
