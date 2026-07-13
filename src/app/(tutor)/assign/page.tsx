import { requireTutor } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { AssignForm } from "./assign-form";

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
export default async function AssignPage() {
  const tutor = await requireTutor();

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
  const versionOptions = publishedSets.map((s) => ({
    versionId: s.versions[0]?.id,
    label: `${s.title} (v${s.versions[0]?.version}, ${s.mode})`,
    disabled: !s.versions[0]?.id,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Assign homework</h1>
        <p className="text-sm text-slate-500">
          Pick a published version, choose students, set an optional due date.
        </p>
      </div>

      {versionOptions.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-slate-500">
          No published sets yet. Publish a set first.
        </div>
      ) : students.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-slate-500">
          No students on your roster yet.
        </div>
      ) : (
        <AssignForm versionOptions={versionOptions} students={students} />
      )}
    </div>
  );
}
