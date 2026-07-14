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
        <h1 className="font-serif text-2xl tracking-tight">Puzzle sets</h1>
        <Link
          href="/tutor/sets/new"
          className="bg-rust text-paper px-3 py-1.5 text-[11px] uppercase tracking-[0.07em] hover:opacity-90 active:scale-[0.98]"
        >
          New set →
        </Link>
      </div>

      {sets.length === 0 ? (
        <p className="border border-line bg-panel px-4 py-8 text-center text-[13px] text-muted">
          No sets yet.{" "}
          <Link href="/tutor/sets/new" className="text-rust hover:underline underline-offset-2">
            Create your first set
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-line border border-line bg-panel">
          {sets.map((s) => (
            <li key={s.id} className="flex justify-between items-center p-4">
              <div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/tutor/sets/${s.id}`}
                    className="font-serif text-lg tracking-tight text-ink hover:text-rust"
                  >
                    {s.title}
                  </Link>
                  <ModeBadge mode={s.mode} />
                </div>
                <p className="mt-0.5 text-[13px] text-body">
                  {s.description ?? "—"}
                </p>
              </div>
              <div className="text-right">
                <div className="text-[12px] uppercase tracking-[0.05em] text-muted">
                  {s._count.versions} {s._count.versions === 1 ? "version" : "versions"}
                </div>
                {s.mode === "MANUAL" && (
                  <div className="text-[12px] uppercase tracking-[0.05em] text-muted">
                    {s._count.items} puzzles
                  </div>
                )}
                <div
                  className={`mt-1 inline-block text-[10px] uppercase tracking-[0.06em] px-2 py-0.5 border ${
                    s.isPublished
                      ? "border-success/40 text-success"
                      : "border-warning text-warning"
                  }`}
                >
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
      className={`text-[10px] uppercase tracking-[0.06em] px-2 py-0.5 border ${
        mode === "FILTER"
          ? "border-info text-info"
          : "border-line text-muted"
      }`}
    >
      {mode}
    </span>
  );
}
