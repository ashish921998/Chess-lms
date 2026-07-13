import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTutor } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { SetEditor } from "./set-editor";

export const dynamic = "force-dynamic";

/**
 * Set editor. Loads the set scoped by tutor (cross-tutor → 404, never an
 * existence leak), then renders a mode-aware editor:
 *   - MANUAL: add/remove puzzles by ID, publish.
 *   - FILTER: edit themes/rating/targetCount with a live preview count, publish.
 * Editing a published set does not unpublish or touch existing versions; a
 * re-publish creates version + 1 (the editor surfaces the current latest version).
 */
export default async function SetEditorPage({
  params,
}: {
  params: Promise<{ setId: string }>;
}) {
  const tutor = await requireTutor();
  const { setId } = await params;

  const set = await db.puzzleSet.findUnique({
    where: { id: setId },
    include: {
      items: { orderBy: { order: "asc" }, include: { puzzle: true } },
      versions: { orderBy: { version: "desc" }, take: 1 },
    },
  });
  if (!set || set.tutorId !== tutor.id) notFound();

  // Distinct theme values across the library, for the FILTER editor's checkboxes
  // (only fetched when the set is FILTER; MANUAL never renders them).
  const availableThemes =
    set.mode === "FILTER"
      ? await db.$queryRaw<{ theme: string }[]>`
          SELECT DISTINCT t.theme
          FROM "Puzzle" p, unnest(p.themes) AS t(theme)
          WHERE t.theme <> ''
          ORDER BY t.theme
        `.then((rows) => rows.map((r) => r.theme))
      : [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/tutor/sets" className="text-sm text-slate-500 hover:text-slate-900">
          ← Sets
        </Link>
        <div className="flex items-center gap-2 mt-2">
          <h1 className="text-2xl font-bold">{set.title}</h1>
          <span
            className={`text-xs px-2 py-0.5 rounded ${
              set.mode === "FILTER"
                ? "bg-purple-50 text-purple-700"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            {set.mode}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded ${
              set.isPublished
                ? "bg-green-50 text-green-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {set.isPublished ? "Published" : "Draft"}
          </span>
        </div>
        {set.description && (
          <p className="text-sm text-slate-500 mt-1">{set.description}</p>
        )}
        {set.versions.length > 0 && (
          <p className="text-xs text-slate-400 mt-1">
            Latest version: v{set.versions[0].version}
          </p>
        )}
      </div>

      <SetEditor
        setId={set.id}
        mode={set.mode}
        isPublished={set.isPublished}
        latestVersion={set.versions[0]?.version ?? null}
        manualItems={
          set.mode === "MANUAL"
            ? set.items.map((it) => ({
                id: it.id,
                puzzleId: it.puzzleId,
                order: it.order,
                rating: it.puzzle.rating,
                themes: it.puzzle.themes,
              }))
            : []
        }
        filter={{
          themes: set.filterThemes,
          ratingMin: set.filterRatingMin,
          ratingMax: set.filterRatingMax,
          targetCount: set.targetCount,
        }}
        availableThemes={availableThemes}
      />
    </div>
  );
}
