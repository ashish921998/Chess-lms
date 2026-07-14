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
        <Link
          href="/tutor/sets"
          className="text-[12px] uppercase tracking-[0.06em] text-rust hover:underline underline-offset-2"
        >
          ← Sets
        </Link>
        <div className="flex items-center gap-2 mt-2">
          <h1 className="font-serif text-2xl tracking-tight">{set.title}</h1>
          <span
            className={`text-[10px] uppercase tracking-[0.06em] px-2 py-0.5 border ${
              set.mode === "FILTER"
                ? "border-info text-info"
                : "border-line text-muted"
            }`}
          >
            {set.mode}
          </span>
          <span
            className={`text-[10px] uppercase tracking-[0.06em] px-2 py-0.5 border ${
              set.isPublished
                ? "border-success/40 text-success"
                : "border-warning text-warning"
            }`}
          >
            {set.isPublished ? "Published" : "Draft"}
          </span>
        </div>
        {set.description && (
          <p className="mt-1 text-[13px] text-body">{set.description}</p>
        )}
        {set.versions.length > 0 && (
          <p className="mt-1 text-[11px] uppercase tracking-[0.05em] text-muted2">
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
