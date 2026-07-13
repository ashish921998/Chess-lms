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
        <p className="text-red-700 text-sm bg-red-50 rounded px-3 py-2">{error}</p>
      )}
      {info && (
        <p className="text-green-700 text-sm bg-green-50 rounded px-3 py-2">{info}</p>
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
    <section className="rounded-lg border bg-white p-6 space-y-6">
      <h2 className="text-lg font-semibold">Puzzles ({items.length})</h2>

      {/* Add by ID */}
      <div>
        <h3 className="text-sm font-medium text-slate-700 mb-2">Add by puzzle ID</h3>
        <form onSubmit={add} className="flex gap-2">
          <input
            value={puzzleId}
            onChange={(e) => setPuzzleId(e.target.value)}
            placeholder="Puzzle ID"
            className="flex-1 border rounded px-3 py-2 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={disabled || !puzzleId.trim()}
            className="bg-slate-900 text-white rounded px-3 py-2 hover:bg-slate-800 disabled:opacity-50 text-sm"
          >
            Add
          </button>
        </form>
      </div>

      {/* Search by rating/themes */}
      <div className="border-t pt-4">
        <h3 className="text-sm font-medium text-slate-700 mb-2">Or search the library</h3>
        <form onSubmit={runSearch} className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <input
              value={sRatingMin}
              onChange={(e) => setSRatingMin(e.target.value)}
              type="number"
              placeholder="Rating min"
              className="border rounded px-3 py-2 text-sm"
            />
            <input
              value={sRatingMax}
              onChange={(e) => setSRatingMax(e.target.value)}
              type="number"
              placeholder="Rating max"
              className="border rounded px-3 py-2 text-sm"
            />
            <input
              value={sThemes}
              onChange={(e) => setSThemes(e.target.value)}
              placeholder="themes: a, b"
              className="border rounded px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="border rounded px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </form>

        {results && (
          <ul className="mt-3 divide-y rounded border max-h-64 overflow-auto">
            {results.length === 0 ? (
              <li className="p-3 text-sm text-slate-500">No puzzles match.</li>
            ) : (
              results.map((p) => {
                const inSet = alreadyInSet.has(p.id);
                return (
                  <li key={p.id} className="flex items-center justify-between p-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono">{p.id}</span>
                      <span className="bg-slate-100 text-slate-700 text-xs px-1.5 py-0.5 rounded">
                        {p.rating}
                      </span>
                      {p.themes.slice(0, 2).map((t) => (
                        <span key={t} className="bg-blue-50 text-blue-700 text-xs px-1.5 py-0.5 rounded">
                          {t}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => addFromSearch(p.id)}
                      disabled={disabled || inSet}
                      className="text-blue-600 text-sm hover:underline disabled:opacity-40"
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
        <p className="text-sm text-slate-500 border-t pt-4">
          No puzzles yet. Add by ID or search above.
        </p>
      ) : (
        <ol className="divide-y rounded border border-t pt-0">
          {items.map((it, i) => (
            <li key={it.id} className="flex items-center justify-between p-3">
              <div className="flex items-center gap-3">
                <span className="text-slate-400 text-sm w-6">{i + 1}.</span>
                <span className="font-mono text-sm">{it.puzzleId}</span>
                <span className="bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded">
                  {it.rating}
                </span>
                {it.themes.slice(0, 3).map((t) => (
                  <span key={t} className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded">
                    {t}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => move(i, i - 1)}
                  disabled={disabled || i === 0}
                  className="text-slate-500 hover:text-slate-900 disabled:opacity-30 text-sm"
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  onClick={() => move(i, i + 1)}
                  disabled={disabled || i === items.length - 1}
                  className="text-slate-500 hover:text-slate-900 disabled:opacity-30 text-sm"
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  onClick={() => remove(it.puzzleId)}
                  disabled={disabled}
                  className="text-red-600 text-sm hover:underline disabled:opacity-50"
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
    <section className="rounded-lg border bg-white p-6 space-y-4">
      <h2 className="text-lg font-semibold">Filter criteria</h2>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="block text-sm text-slate-600 mb-1">
            Themes <span className="text-slate-400">(none = any theme)</span>
          </label>
          {availableThemes.length === 0 ? (
            <p className="text-sm text-slate-500">No themes found in the library.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto rounded border p-2">
              {availableThemes.map((t) => {
                const on = selectedThemes.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTheme(t)}
                    className={`text-xs px-2 py-1 rounded ${
                      on
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          )}
          {selectedThemes.size > 0 && (
            <p className="text-xs text-slate-500 mt-1">
              {selectedThemes.size} selected
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-slate-600 mb-1">Rating min</label>
            <input
              value={ratingMin}
              onChange={(e) => setRatingMin(e.target.value)}
              type="number"
              placeholder="800"
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">Rating max</label>
            <input
              value={ratingMax}
              onChange={(e) => setRatingMax(e.target.value)}
              type="number"
              placeholder="1600"
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm text-slate-600 mb-1">Target solves</label>
          <input
            value={targetCount}
            onChange={(e) => setTargetCount(e.target.value)}
            type="number"
            min={1}
            required
            placeholder="20"
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={disabled}
            className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-800 disabled:opacity-50 text-sm"
          >
            Save criteria
          </button>
          {previewing ? (
            <span className="text-sm text-slate-400">counting…</span>
          ) : previewCount !== null ? (
            <span className="text-sm text-slate-600">
              <strong>{previewCount}</strong> puzzle{previewCount === 1 ? "" : "s"} match
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
    <section className="rounded-lg border bg-slate-50 p-6 flex items-center justify-between">
      <div className="text-sm">
        <p className="font-medium text-slate-900">Publishing</p>
        <p className="text-slate-500">
          {isPublished
            ? `Published (v${latestVersion}). Editing the draft does not change in-flight assignments — publish again to create v${(latestVersion ?? 0) + 1}.`
            : "Publish an immutable snapshot. Assignments reference a version, so later edits never change in-flight work."}
        </p>
        {!canPublish && (
          <p className="text-amber-700 mt-1">
            {mode === "MANUAL"
              ? "Add at least one puzzle before publishing."
              : "Set a target solve count before publishing."}
          </p>
        )}
      </div>
      <button
        onClick={publish}
        disabled={disabled || publishing || !canPublish}
        className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-800 disabled:opacity-50 text-sm whitespace-nowrap"
      >
        {publishing ? "Publishing…" : isPublished ? `Publish v${(latestVersion ?? 0) + 1}` : "Publish"}
      </button>
    </section>
  );
}
