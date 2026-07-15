import Link from "next/link";
import { requireTutor } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { modeLabel } from "@/lib/puzzles/mode-label";

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
    <div className="space-y-9">
      <div className="page-heading">
        <div><div className="page-kicker">Course builder</div><h1>Puzzle sets</h1><p>Build focused training collections and reuse them across your roster.</p></div>
        <Link href="/tutor/sets/new" className="primary-action">New set →</Link>
      </div>

      {sets.length === 0 ? (
        <p className="surface-card px-4 py-12 text-center text-[13px] text-muted">
          No sets yet.{" "}
          <Link href="/tutor/sets/new" className="text-rust hover:underline underline-offset-2">
            Create your first set
          </Link>
          .
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {sets.map((s) => (
            <li key={s.id} className="surface-card flex min-h-44 flex-col justify-between p-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/tutor/sets/${s.id}`}
                    className="font-serif text-xl tracking-tight text-ink hover:text-rust"
                  >
                    {s.title}
                  </Link>
                  <ModeBadge mode={s.mode} />
                </div>
                <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-body">
                  {s.description ?? "No description yet."}
                </p>
              </div>
              <div className="mt-5 flex items-center justify-between border-t border-line/70 pt-4">
                <div className="text-[10px] text-muted">{s._count.versions} {s._count.versions === 1 ? "version" : "versions"}{s.mode === "MANUAL" ? ` · ${s._count.items} puzzles` : " · adaptive"}</div>
                <div
                  className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${
                    s.isPublished
                      ? "bg-success/10 text-success"
                      : "bg-warning/10 text-warning"
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
      className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${
        mode === "FILTER"
          ? "bg-info/10 text-info"
          : "bg-shade text-muted"
      }`}
    >
      {modeLabel(mode)}
    </span>
  );
}
