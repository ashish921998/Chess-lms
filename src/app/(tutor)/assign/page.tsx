import { requireTutor } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { AssignForm } from "./assign-form";
import { modeLabel } from "@/lib/puzzles/mode-label";

export const dynamic = "force-dynamic";

/**
 * Tutor assign page. Lists this tutor's students and the latest version of each
 * published set. The client form picks a version + student(s) + due date and
 * POSTs to /api/tutor/assignments (idempotent per version+student).
 *
 * Per spec §Assign: only published sets are assignable; a re-assign of the same
 * (version, student) is a skip-if-exists no-op, so existing in-flight progress
 * is preserved.
 */
export default async function AssignPage({
  searchParams,
}: {
  searchParams: Promise<{ set?: string }>;
}) {
  const tutor = await requireTutor();
  const { set: preselectVersionId } = await searchParams;

  const [students, publishedSets] = await Promise.all([
    db.student.findMany({
      where: { tutorId: tutor.id },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true, inAppRating: true },
    }),
    db.puzzleSet.findMany({
      where: { tutorId: tutor.id, isPublished: true },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        mode: true,
        versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true } },
      },
    }),
  ]);

  // Flatten to <setId, versionId, label> options — always the latest version.
  // Tutors pick a set by name; the version is resolved to the latest published
  // one behind the scenes (the label never exposes the version machinery).
  const versionOptions = publishedSets.map((s) => ({
    versionId: s.versions[0]?.id,
    label: `${s.title} · ${modeLabel(s.mode)}`,
    disabled: !s.versions[0]?.id,
  }));

  return (
    <div className="space-y-9">
      <div className="page-heading"><div><div className="page-kicker">Create an assignment</div>
        <h1>Assign homework</h1>
        <p>
          Pick a set, choose students, set an optional due date.
        </p></div></div>

      {versionOptions.length === 0 ? (
        <p className="border border-line bg-panel px-4 py-8 text-center text-[13px] text-muted">
          No published sets yet. Publish a set first.
        </p>
      ) : students.length === 0 ? (
        <p className="border border-line bg-panel px-4 py-8 text-center text-[13px] text-muted">
          No students on your roster yet.
        </p>
      ) : (
        <AssignForm
          versionOptions={versionOptions}
          students={students}
          preselectVersionId={
            versionOptions.some((o) => o.versionId === preselectVersionId)
              ? preselectVersionId
              : undefined
          }
        />
      )}
    </div>
  );
}
