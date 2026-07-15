"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { BoardPreview } from "@/components/chess/board-preview";

type ManualSet = { id: string; title: string; isPublished: boolean };

type Puzzle = {
  id: string;
  rating: number;
  themes: string[];
  popularity: number;
  startFen: string;
  openingTags: string[];
};

type Props = {
  sets: ManualSet[];
  themes: string[];
};

const LIMITS = [50, 100, 200];

/**
 * Interactive puzzle browser. Filters by rating range + themes, renders a grid
 * of cards each with a static board preview, and adds puzzles to a chosen
 * MANUAL set in one click. The target set's current items are fetched on
 * selection so already-added puzzles show "Added ✓".
 */
export function LibraryBrowser({ sets, themes }: Props) {
  const [targetSetId, setTargetSetId] = useState<string>(sets[0]?.id ?? "");
  const [ratingMin, setRatingMin] = useState("");
  const [ratingMax, setRatingMax] = useState("");
  const [selectedThemes, setSelectedThemes] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Puzzle[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [limit, setLimit] = useState(LIMITS[0]);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleTheme = useCallback((theme: string) => {
    setSelectedThemes((prev) => {
      const next = new Set(prev);
      if (next.has(theme)) next.delete(theme);
      else next.add(theme);
      return next;
    });
  }, []);

  // When the target set changes, fetch its current puzzle IDs so we can mark
  // already-added puzzles in the results grid.
  useEffect(() => {
    if (!targetSetId) {
      setAddedIds(new Set());
      return;
    }
    let cancelled = false;
    fetch(`/api/tutor/sets/${targetSetId}/items`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { puzzleIds: string[] }) => {
        if (!cancelled) setAddedIds(new Set(data.puzzleIds));
      })
      .catch(() => {
        if (!cancelled) setAddedIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [targetSetId]);

  const runSearch = useCallback(
    (nextLimit?: number) => {
      const params = new URLSearchParams();
      if (ratingMin) params.set("ratingMin", ratingMin);
      if (ratingMax) params.set("ratingMax", ratingMax);
      if (selectedThemes.size > 0) params.set("themes", [...selectedThemes].join(","));
      params.set("limit", String(nextLimit ?? limit));
      setSearching(true);
      setError(null);
      fetch(`/api/tutor/puzzles/search?${params}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data: { puzzles: Puzzle[] }) => setResults(data.puzzles))
        .catch(() => setError("Search failed. Try again."))
        .finally(() => setSearching(false));
    },
    [ratingMin, ratingMax, selectedThemes, limit]
  );

  const addToSet = useCallback(
    async (puzzleId: string) => {
      if (!targetSetId) return;
      setPendingId(puzzleId);
      setError(null);
      try {
        const r = await fetch(`/api/tutor/sets/${targetSetId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ puzzleId }),
        });
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          throw new Error(body?.error ?? "add_failed");
        }
        setAddedIds((prev) => new Set(prev).add(puzzleId));
      } catch {
        setError(`Could not add ${puzzleId}.`);
      } finally {
        setPendingId(null);
      }
    },
    [targetSetId]
  );

  const showMore = () => {
    const idx = LIMITS.indexOf(limit);
    if (idx < LIMITS.length - 1) {
      const next = LIMITS[idx + 1];
      setLimit(next);
      runSearch(next);
    }
  };

  const canShowMore = limit < LIMITS[LIMITS.length - 1] && results && results.length >= limit;

  const inputCls =
    "w-full border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:border-ink";

  return (
    <div className="space-y-6">
      {error && (
        <div className="border border-error/40 text-error px-3 py-2 text-[13px]">{error}</div>
      )}

      {/* Target set selector */}
      <section className="border border-line bg-panel p-6">
        <label className="block text-[11px] uppercase tracking-[0.07em] text-muted2 mb-2">
          Adding to
        </label>
        <select
          value={targetSetId}
          onChange={(e) => setTargetSetId(e.target.value)}
          className={inputCls}
        >
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
              {s.isPublished ? " (Published)" : " (Draft)"}
            </option>
          ))}
        </select>
      </section>

      {/* Filters */}
      <section className="border border-line bg-panel p-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] uppercase tracking-[0.07em] text-muted2 mb-1">
              Rating min
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={ratingMin}
              onChange={(e) => setRatingMin(e.target.value)}
              placeholder="400"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.07em] text-muted2 mb-1">
              Rating max
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={ratingMax}
              onChange={(e) => setRatingMax(e.target.value)}
              placeholder="2300"
              className={inputCls}
            />
          </div>
        </div>

        {themes.length > 0 && (
          <div>
            <label className="block text-[11px] uppercase tracking-[0.07em] text-muted2 mb-2">
              Themes
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto border border-line bg-paper p-2">
              {themes.map((t) => {
                const on = selectedThemes.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTheme(t)}
                    className={`text-[11px] px-2 py-0.5 border ${
                      on
                        ? "bg-ink text-paper border-ink"
                        : "bg-paper text-muted border-line hover:border-ink"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => runSearch()}
          disabled={searching}
          className="bg-rust text-paper px-4 py-2 text-[11px] uppercase tracking-[0.07em] hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </section>

      {/* Results */}
      {results === null ? (
        <p className="text-[13px] text-muted2">
          Run a search to browse puzzles. Showing most popular first.
        </p>
      ) : results.length === 0 ? (
        <p className="text-[13px] text-muted2">No puzzles match these filters.</p>
      ) : (
        <>
          <p className="text-[11px] uppercase tracking-[0.05em] text-muted2">
            {results.length} puzzle{results.length === 1 ? "" : "s"}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((p) => {
              const added = addedIds.has(p.id);
              return (
                <div key={p.id} className="border border-line bg-panel p-4 space-y-3">
                  <div className="flex justify-center">
                    <BoardPreview fen={p.startFen} />
                  </div>
                  <div className="space-y-2">
                    <p className="font-mono text-[11px] text-muted2 break-all">{p.id}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-[0.06em] px-2 py-0.5 border border-line text-muted">
                        {p.rating}
                      </span>
                      {p.themes.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="text-[10px] uppercase tracking-[0.06em] px-2 py-0.5 border border-info text-info"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => addToSet(p.id)}
                      disabled={added || pendingId === p.id || !targetSetId}
                      className={`w-full px-3 py-1.5 text-[11px] uppercase tracking-[0.06em] border ${
                        added
                          ? "border-success/40 text-success cursor-default"
                          : "border-rust text-rust hover:bg-rust hover:text-paper disabled:opacity-50"
                      }`}
                    >
                      {added ? "Added ✓" : pendingId === p.id ? "Adding…" : "Add to set"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {canShowMore && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={showMore}
                disabled={searching}
                className="border border-ink text-ink px-4 py-2 text-[11px] uppercase tracking-[0.07em] hover:bg-ink hover:text-paper disabled:opacity-50"
              >
                {searching ? "Loading…" : "Show more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
