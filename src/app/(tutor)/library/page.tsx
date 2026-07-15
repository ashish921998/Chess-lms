import Link from "next/link";
import { requireTutor } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { LibraryBrowser } from "./library-browser";

export const dynamic = "force-dynamic";

/**
 * Puzzle library. A shared, global catalog (sourced from the Lichess puzzle
 * database) that tutors browse by rating range + themes, with board previews,
 * and add puzzles directly to a target MANUAL set — no more blind ID entry.
 */
export default async function LibraryPage() {
  const tutor = await requireTutor();

  const [manualSets, themeRows] = await Promise.all([
    db.puzzleSet.findMany({
      where: { tutorId: tutor.id, mode: "MANUAL" },
      select: { id: true, title: true, isPublished: true },
      orderBy: { title: "asc" },
    }),
    db.$queryRaw<{ theme: string }[]>`
      SELECT DISTINCT t.theme
      FROM "Puzzle" p, unnest(p.themes) AS t(theme)
      WHERE t.theme <> ''
      ORDER BY t.theme
    `.then((rows) => rows.map((r) => r.theme)),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl tracking-tight">Puzzle library</h1>
        <p className="mt-1 text-[13px] text-body">
          Browse the catalog, preview positions, and add puzzles to a set.
        </p>
      </div>

      {manualSets.length === 0 ? (
        <div className="border border-line bg-panel p-6">
          <p className="text-[13px] text-body">
            You need a MANUAL set to add puzzles to.{" "}
            <Link
              href="/tutor/sets/new"
              className="text-rust hover:underline underline-offset-2"
            >
              Create one →
            </Link>
          </p>
        </div>
      ) : (
        <LibraryBrowser sets={manualSets} themes={themeRows} />
      )}
    </div>
  );
}
