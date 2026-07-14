"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

type Mode = "MANUAL" | "FILTER";

type ManualItem = {
  id: string;
  puzzleId: string;
  order: number;
  rating: number;
  themes: string[];
};

type Props = {
  setId: string;
  mode: Mode;
  isPublished: boolean;
  latestVersion: number | null;
  manualItems: ManualItem[];
  filter: {
    themes: string[];
    ratingMin: number | null;
    ratingMax: number | null;
    targetCount: number | null;
  };
  /** Distinct theme values across the puzzle library, for the FILTER checkboxes. */
  availableThemes: string[];
};

/**
 * Mode-aware set editor. MANUAL: add/remove puzzle IDs + publish. FILTER: edit
 * criteria with a live preview count + publish. Mutations hit the tutor API and
 * refresh the page (router.refresh()) so the server-rendered draft stays the
 * source of truth — the client holds no puzzle/set state beyond form inputs.
 */
export function SetEditor({
  setId,
  mode,
  isPublished,
  latestVersion,
  manualItems,
  filter,
  availableThemes,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  return (
    <div className="space-y-6">
      {error && (
        <p className="border border-error/40 text-error px-3 py-2 text-[13px]">{error}</p>
      )}
      {info && (
        <p className="border border-success/40 text-success px-3 py-2 text-[13px]">{info}</p>
      )}

      {mode === "MANUAL" ? (
        <ManualEditor
          setId={setId}
          items={manualItems}
          disabled={pending}
          onError={setError}
          onInfo={setInfo}
          onChanged={refresh}
        />
      ) : (
        <FilterEditor
          setId={setId}
          initial={filter}
          availableThemes={availableThemes}
          disabled={pending}
          onError={setError}
          onInfo={setInfo}
          onChanged={refresh}
        />
      )}

      <PublishBar
        setId={setId}
        isPublished={isPublished}
        latestVersion={latestVersion}
        mode={mode}
        canPublish={mode === "MANUAL" ? manualItems.length > 0 : filter.targetCount != null}
        disabled={pending}
        onError={setError}
        onInfo={setInfo}
        onChanged={refresh}
      />
    </div>
  );
}

// ── MANUAL editor ──

type SearchResult = { id: string; rating: number; themes: string[] };

function ManualEditor({
  setId,
  items,
  disabled,
  onError,
  onInfo,
  onChanged,
}: {
  setId: string;
  items: ManualItem[];
  disabled: boolean;
  onError: (m: string) => void;
  onInfo: (m: string) => void;
  onChanged: () => void;
}) {
  const [puzzleId, setPuzzleId] = useState("");
  // Search box state.
  const [sRatingMin, setSRatingMin] = useState("");
  const [sRatingMax, setSRatingMax] = useState("");
  const [sThemes, setSThemes] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const alreadyInSet = new Set(items.map((i) => i.puzzleId));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    onError("");
    const id = puzzleId.trim();
    if (!id) return;
    const res = await fetch(`/api/tutor/sets/${setId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ puzzleId: id }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      onError(j.error || `Failed (${res.status})`);
      return;
    }
    setPuzzleId("");
    onInfo(`Added ${id}`);
    onChanged();
  }

  async function remove(pid: string) {
    onError("");
    const res = await fetch(`/api/tutor/sets/${setId}/items?puzzleId=${encodeURIComponent(pid)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      onError(j.error || `Failed (${res.status})`);
      return;
    }
    onInfo(`Removed ${pid}`);
    onChanged();
  }

  async function move(from: number, to: number) {
    if (to < 0 || to >= items.length) return;
    onError("");
    const next = items.map((i) => i.puzzleId);
    [next[from], next[to]] = [next[to], next[from]];
    const res = await fetch(`/api/tutor/sets/${setId}/items`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedPuzzleIds: next }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      onError(j.error || `Failed (${res.status})`);
      return;
    }
    onChanged();
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearching(true);
    try {
      const params = new URLSearchParams();
      if (sRatingMin) params.set("ratingMin", sRatingMin);
      if (sRatingMax) params.set("ratingMax", sRatingMax);
      const themes = sThemes.split(",").map((t) => t.trim()).filter(Boolean);
      if (themes.length) params.set("themes", themes.join(","));
      const res = await fetch(`/api/tutor/puzzles/search?${params}`);
      if (res.ok) {
        const { puzzles } = await res.json();
        setResults(puzzles);
      }
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className="border border-line bg-panel p-6 space-y-6">
      <h2 className="font-serif text-lg tracking-tight">Puzzles ({items.length})</h2>

      {/* Add by ID */}
      <div>
        <h3 className="mb-2 text-[11px] uppercase tracking-[0.07em] text-muted2">Add by puzzle ID</h3>
        <form onSubmit={add} className="flex gap-2">
          <input
            value={puzzleId}
            onChange={(e) => setPuzzleId(e.target.value)}
            placeholder="Puzzle ID"
            className="flex-1 border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:border-ink"
          />
          <button
            type="submit"
            disabled={disabled || !puzzleId.trim()}
            className="bg-ink text-paper px-3 py-2 text-[11px] uppercase tracking-[0.07em] hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          >
            Add
          </button>
        </form>
      </div>

      {/* Search by rating/themes */}
      <div className="border-t border-line pt-4">
        <h3 className="mb-2 text-[11px] uppercase tracking-[0.07em] text-muted2">Or search the library</h3>
        <form onSubmit={runSearch} className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <input
              value={sRatingMin}
              onChange={(e) => setSRatingMin(e.target.value)}
              type="number"
              placeholder="Rating min"
              className="border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:border-ink"
            />
            <input
              value={sRatingMax}
              onChange={(e) => setSRatingMax(e.target.value)}
              type="number"
              placeholder="Rating max"
              className="border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:border-ink"
            />
            <input
              value={sThemes}
              onChange={(e) => setSThemes(e.target.value)}
              placeholder="themes: a, b"
              className="border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:border-ink"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="border border-ink px-3 py-1.5 text-[11px] uppercase tracking-[0.07em] text-ink hover:bg-ink hover:text-paper active:scale-[0.98] disabled:opacity-50"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </form>

        {results && (
          <ul className="mt-3 divide-y divide-line border border-line max-h-64 overflow-auto">
            {results.length === 0 ? (
              <li className="p-3 text-[13px] text-muted">No puzzles match.</li>
            ) : (
              results.map((p) => {
                const inSet = alreadyInSet.has(p.id);
                return (
                  <li key={p.id} className="flex items-center justify-between p-2">
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="font-mono text-ink">{p.id}</span>
                      <span className="text-[10px] uppercase tracking-[0.06em] px-1.5 py-0.5 border border-line text-muted">
                        {p.rating}
                      </span>
                      {p.themes.slice(0, 2).map((t) => (
                        <span key={t} className="text-[10px] uppercase tracking-[0.06em] px-1.5 py-0.5 border border-info text-info">
                          {t}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => addFromSearch(p.id)}
                      disabled={disabled || inSet}
                      className="text-rust text-[12px] hover:underline disabled:opacity-40"
                    >
                      {inSet ? "added" : "add"}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>

      {/* Ordered list with reorder controls */}
      {items.length === 0 ? (
        <p className="text-[13px] text-muted border-t border-line pt-4">
          No puzzles yet. Add by ID or search above.
        </p>
      ) : (
        <ol className="divide-y divide-line border border-line border-t-0">
          {items.map((it, i) => (
            <li key={it.id} className="flex items-center justify-between p-3">
              <div className="flex items-center gap-3">
                <span className="text-muted2 text-[13px] w-6 font-mono">{i + 1}.</span>
                <span className="font-mono text-[13px] text-ink">{it.puzzleId}</span>
                <span className="text-[10px] uppercase tracking-[0.06em] px-2 py-0.5 border border-line text-muted">
                  {it.rating}
                </span>
                {it.themes.slice(0, 3).map((t) => (
                  <span key={t} className="text-[10px] uppercase tracking-[0.06em] px-2 py-0.5 border border-info text-info">
                    {t}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => move(i, i - 1)}
                  disabled={disabled || i === 0}
                  className="text-muted hover:text-ink disabled:opacity-30 text-[13px]"
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  onClick={() => move(i, i + 1)}
                  disabled={disabled || i === items.length - 1}
                  className="text-muted hover:text-ink disabled:opacity-30 text-[13px]"
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  onClick={() => remove(it.puzzleId)}
                  disabled={disabled}
                  className="text-error text-[12px] hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );

  async function addFromSearch(id: string) {
    onError("");
    const res = await fetch(`/api/tutor/sets/${setId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ puzzleId: id }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      onError(j.error || `Failed (${res.status})`);
      return;
    }
    onInfo(`Added ${id}`);
    onChanged();
  }
}

// ── FILTER editor ──

function FilterEditor({
  setId,
  initial,
  availableThemes,
  disabled,
  onError,
  onInfo,
  onChanged,
}: {
  setId: string;
  initial: Props["filter"];
  availableThemes: string[];
  disabled: boolean;
  onError: (m: string) => void;
  onInfo: (m: string) => void;
  onChanged: () => void;
}) {
  const [selectedThemes, setSelectedThemes] = useState<Set<string>>(
    new Set(initial.themes)
  );
  const [ratingMin, setRatingMin] = useState(initial.ratingMin?.toString() ?? "");
  const [ratingMax, setRatingMax] = useState(initial.ratingMax?.toString() ?? "");
  const [targetCount, setTargetCount] = useState(initial.targetCount?.toString() ?? "");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);

  function toggleTheme(t: string) {
    setSelectedThemes((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  }

  // Live, debounced preview count: re-runs ~400ms after themes/rating stop
  // changing. Avoids hammering the DB on each keystroke.
  useEffect(() => {
    const handle = setTimeout(async () => {
      setPreviewing(true);
      try {
        const res = await fetch(`/api/tutor/sets/${setId}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            themes: [...selectedThemes],
            ratingMin: ratingMin ? Number(ratingMin) : null,
            ratingMax: ratingMax ? Number(ratingMax) : null,
          }),
        });
        if (res.ok) {
          const { count } = await res.json();
          setPreviewCount(count);
        }
      } finally {
        setPreviewing(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [setId, selectedThemes, ratingMin, ratingMax]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    onError("");
    const res = await fetch(`/api/tutor/sets/${setId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filterThemes: [...selectedThemes],
        filterRatingMin: ratingMin ? Number(ratingMin) : null,
        filterRatingMax: ratingMax ? Number(ratingMax) : null,
        targetCount: targetCount ? Number(targetCount) : null,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      onError(j.error || `Failed (${res.status})`);
      return;
    }
    onInfo("Saved criteria");
    onChanged();
  }

  return (
    <section className="border border-line bg-panel p-6 space-y-4">
      <h2 className="font-serif text-lg tracking-tight">Filter criteria</h2>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="block mb-1 text-[11px] uppercase tracking-[0.07em] text-muted2">
            Themes <span className="text-muted">(none = any theme)</span>
          </label>
          {availableThemes.length === 0 ? (
            <p className="text-[13px] text-muted">No themes found in the library.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto border border-line bg-paper p-2">
              {availableThemes.map((t) => {
                const on = selectedThemes.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTheme(t)}
                    className={`text-[11px] uppercase tracking-[0.06em] px-2 py-1 border transition-colors ${
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
          )}
          {selectedThemes.size > 0 && (
            <p className="mt-1 text-[12px] text-muted">
              {selectedThemes.size} selected
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block mb-1 text-[12px] text-muted">Rating min</label>
            <input
              value={ratingMin}
              onChange={(e) => setRatingMin(e.target.value)}
              type="number"
              placeholder="800"
              className="w-full border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:border-ink"
            />
          </div>
          <div>
            <label className="block mb-1 text-[12px] text-muted">Rating max</label>
            <input
              value={ratingMax}
              onChange={(e) => setRatingMax(e.target.value)}
              type="number"
              placeholder="1600"
              className="w-full border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:border-ink"
            />
          </div>
        </div>
        <div>
          <label className="block mb-1 text-[12px] text-muted">Target solves</label>
          <input
            value={targetCount}
            onChange={(e) => setTargetCount(e.target.value)}
            type="number"
            min={1}
            required
            placeholder="20"
            className="w-full border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:border-ink"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={disabled}
            className="bg-ink text-paper px-4 py-2 text-[11px] uppercase tracking-[0.07em] hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          >
            Save criteria
          </button>
          {previewing ? (
            <span className="text-[12px] text-muted2">counting…</span>
          ) : previewCount !== null ? (
            <span className="text-[12px] uppercase tracking-[0.05em] text-muted">
              <span className="font-mono text-rust">{previewCount}</span> puzzle{previewCount === 1 ? "" : "s"} match
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}

// ── Publish bar ──

function PublishBar({
  setId,
  isPublished,
  latestVersion,
  mode,
  canPublish,
  disabled,
  onError,
  onInfo,
  onChanged,
}: {
  setId: string;
  isPublished: boolean;
  latestVersion: number | null;
  mode: Mode;
  canPublish: boolean;
  disabled: boolean;
  onError: (m: string) => void;
  onInfo: (m: string) => void;
  onChanged: () => void;
}) {
  const [publishing, setPublishing] = useState(false);

  async function publish() {
    onError("");
    setPublishing(true);
    try {
      const res = await fetch(`/api/tutor/sets/${setId}/publish`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        onError(j.error || `Failed (${res.status})`);
        return;
      }
      const { version } = await res.json();
      onInfo(`Published as version ${version}`);
      onChanged();
    } finally {
      setPublishing(false);
    }
  }

  return (
    <section className="border border-line bg-shade p-6 flex items-center justify-between gap-6">
      <div>
        <p className="text-[11px] uppercase tracking-[0.07em] text-muted2">Publishing</p>
        <p className="mt-1 text-[13px] text-body max-w-xl">
          {isPublished
            ? `Published (v${latestVersion}). Editing the draft does not change in-flight assignments — publish again to create v${(latestVersion ?? 0) + 1}.`
            : "Publish an immutable snapshot. Assignments reference a version, so later edits never change in-flight work."}
        </p>
        {!canPublish && (
          <p className="text-warning mt-1 text-[12px]">
            {mode === "MANUAL"
              ? "Add at least one puzzle before publishing."
              : "Set a target solve count before publishing."}
          </p>
        )}
      </div>
      <button
        onClick={publish}
        disabled={disabled || publishing || !canPublish}
        className="bg-rust text-paper px-4 py-2 text-[11px] uppercase tracking-[0.07em] hover:opacity-90 active:scale-[0.98] disabled:opacity-50 whitespace-nowrap"
      >
        {publishing ? "Publishing…" : isPublished ? `Publish v${(latestVersion ?? 0) + 1}` : "Publish"}
      </button>
    </section>
  );
}
