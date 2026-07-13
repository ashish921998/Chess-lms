import Link from "next/link";
import { requireTutor } from "@/lib/auth-guards";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Tutor sets list. One row per PuzzleSet: title, mode badge, published state,
 * and version count. Scoped by tutorId (the where clause is the scope; a
 * cross-tutor set is simply never returned). "New set" → /sets/new.
 */
export default async function SetsPage() {
  const tutor = await requireTutor();

  const sets = await db.puzzleSet.findMany({
    where: { tutorId: tutor.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { versions: true, items: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Puzzle sets</h1>
        <Link
          href="/tutor/sets/new"
          className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded hover:bg-slate-800"
        >
          New set →
        </Link>
      </div>

      {sets.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-slate-500">
          No sets yet.{" "}
          <Link href="/tutor/sets/new" className="text-blue-600 hover:underline">
            Create your first set
          </Link>
          .
        </div>
      ) : (
        <ul className="divide-y rounded-lg border bg-white">
          {sets.map((s) => (
            <li key={s.id} className="flex justify-between items-center p-4">
              <div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/tutor/sets/${s.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {s.title}
                  </Link>
                  <ModeBadge mode={s.mode} />
                </div>
                <p className="text-sm text-slate-500 mt-0.5">
                  {s.description ?? "—"}
                </p>
              </div>
              <div className="text-right text-sm">
                <div className="text-slate-700">
                  {s._count.versions} {s._count.versions === 1 ? "version" : "versions"}
                </div>
                {s.mode === "MANUAL" && (
                  <div className="text-slate-500">{s._count.items} puzzles</div>
                )}
                <div className={s.isPublished ? "text-green-700" : "text-amber-700"}>
                  {s.isPublished ? "Published" : "Draft"}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ModeBadge({ mode }: { mode: "MANUAL" | "FILTER" }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded ${
        mode === "FILTER"
          ? "bg-purple-50 text-purple-700"
          : "bg-slate-100 text-slate-700"
      }`}
    >
      {mode}
    </span>
  );
}
