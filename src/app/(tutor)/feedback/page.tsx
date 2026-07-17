import { requireTutor } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { isDeveloperEmail } from "@/lib/developer";
import { GUIDE_SECTIONS } from "@/lib/tutor/guide";
import { FeedbackBoard, type FeedbackView } from "./feedback-board";

export const dynamic = "force-dynamic";

/**
 * Platform guide + change-request board. Renders the FOR_TUTOR.md guide as
 * structured sections, each with an inline thread where tutors leave comments /
 * feature requests / bugs. The developer (DEVELOPER_EMAILS) gets triage controls
 * (status, dev note, delete-any); regular tutors manage only their own posts.
 */
export default async function FeedbackPage() {
  const tutor = await requireTutor();
  const user = await db.user.findUnique({
    where: { id: tutor.userId },
    select: { name: true, email: true },
  });
  const developer = isDeveloperEmail(user?.email);

  const rows = await db.tutorFeedback.findMany({
    orderBy: [{ sectionId: "asc" }, { createdAt: "asc" }],
  });

  const feedback: FeedbackView[] = rows.map((r) => ({
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
  }));

  return (
    <FeedbackBoard
      sections={GUIDE_SECTIONS}
      feedback={feedback}
      isDeveloper={developer}
    />
  );
}
