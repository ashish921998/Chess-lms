import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTutorActor } from "@/lib/auth-guards";
import { GUIDE_TITLE_LOOKUP } from "@/lib/tutor/guide";

/**
 * Feedback board for the platform guide.
 *
 * GET  — list all feedback (the board is shared; it concerns the platform, not
 *        private student data). Any authenticated tutor can read everything.
 * POST — create a comment / feature request / bug tied to a guide section.
 *        Author is the acting tutor; authorName is snapshotted from the user.
 */
const VALID_KINDS = new Set(["COMMENT", "FEATURE_REQUEST", "BUG"]);
const MAX_BODY = 4000;

export async function GET() {
  const tutor = await getTutorActor();
  if (!tutor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db.tutorFeedback.findMany({
    orderBy: [{ sectionId: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      tutorId: r.tutorId,
      authorName: r.authorName,
      sectionId: r.sectionId,
      sectionTitle: r.sectionTitle,
      kind: r.kind,
      status: r.status,
      body: r.body,
      devNote: r.devNote,
      isOwn: r.tutorId === tutor.id,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    }))
  );
}

export async function POST(req: NextRequest) {
  const tutor = await getTutorActor();
  if (!tutor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const sectionId = typeof body.sectionId === "string" ? body.sectionId : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const kind =
    typeof body.kind === "string" && VALID_KINDS.has(body.kind)
      ? (body.kind as "COMMENT" | "FEATURE_REQUEST" | "BUG")
      : "COMMENT";

  if (!GUIDE_TITLE_LOOKUP.has(sectionId)) {
    return NextResponse.json({ error: "Unknown guide section" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Comment cannot be empty" }, { status: 400 });
  }
  if (text.length > MAX_BODY) {
    return NextResponse.json({ error: `Comment too long (max ${MAX_BODY} chars)` }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id: tutor.userId },
    select: { name: true, email: true },
  });
  const authorName = user?.name?.trim() || "Tutor";

  const created = await db.tutorFeedback.create({
    data: {
      tutorId: tutor.id,
      authorName,
      sectionId,
      sectionTitle: GUIDE_TITLE_LOOKUP.get(sectionId)!,
      kind,
      status: "OPEN",
      body: text,
    },
  });

  return NextResponse.json(
    {
      id: created.id,
      tutorId: created.tutorId,
      authorName: created.authorName,
      sectionId: created.sectionId,
      sectionTitle: created.sectionTitle,
      kind: created.kind,
      status: created.status,
      body: created.body,
      devNote: created.devNote,
      isOwn: true,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
      resolvedAt: null,
    },
    { status: 201 }
  );
}
