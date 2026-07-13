"use client";

import { useState, useTransition, useCallback } from "react";
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

  return (
    <section className="rounded-lg border bg-white p-6 space-y-4">
      <h2 className="text-lg font-semibold">Puzzles ({items.length})</h2>
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

      {items.length === 0 ? (
        <p className="text-sm text-slate-500">
          No puzzles yet. Add puzzle IDs to build the set.
        </p>
      ) : (
        <ol className="divide-y rounded border">
          {items.map((it, i) => (
            <li key={it.id} className="flex items-center justify-between p-3">
              <div className="flex items-center gap-3">
                <span className="text-slate-400 text-sm w-6">{i + 1}.</span>
                <span className="font-mono text-sm">{it.puzzleId}</span>
                <span className="bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded">
                  {it.rating}
                </span>
                {it.themes.slice(0, 3).map((t) => (
                  <span
                    key={t}
                    className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <button
                onClick={() => remove(it.puzzleId)}
                disabled={disabled}
                className="text-red-600 text-sm hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ── FILTER editor ──

function FilterEditor({
  setId,
  initial,
  disabled,
  onError,
  onInfo,
  onChanged,
}: {
  setId: string;
  initial: Props["filter"];
  disabled: boolean;
  onError: (m: string) => void;
  onInfo: (m: string) => void;
  onChanged: () => void;
}) {
  const [themes, setThemes] = useState(initial.themes.join(", "));
  const [ratingMin, setRatingMin] = useState(initial.ratingMin?.toString() ?? "");
  const [ratingMax, setRatingMax] = useState(initial.ratingMax?.toString() ?? "");
  const [targetCount, setTargetCount] = useState(initial.targetCount?.toString() ?? "");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    onError("");
    const res = await fetch(`/api/tutor/sets/${setId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filterThemes: themes
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
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

  // Live preview count: how many puzzles match the current criteria. Hits a
  // tiny read-only endpoint rather than the write API.
  async function runPreview() {
    setPreviewing(true);
    try {
      const themesArr = themes
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await fetch(`/api/tutor/sets/${setId}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themes: themesArr,
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
  }

  return (
    <section className="rounded-lg border bg-white p-6 space-y-4">
      <h2 className="text-lg font-semibold">Filter criteria</h2>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="block text-sm text-slate-600 mb-1">
            Themes <span className="text-slate-400">(comma-separated, empty = any)</span>
          </label>
          <input
            value={themes}
            onChange={(e) => setThemes(e.target.value)}
            placeholder="backRank, mate, fork"
            className="w-full border rounded px-3 py-2"
          />
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
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={disabled}
            className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-800 disabled:opacity-50 text-sm"
          >
            Save criteria
          </button>
          <button
            type="button"
            onClick={runPreview}
            disabled={previewing}
            className="border rounded px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {previewing ? "Counting…" : "Preview count"}
          </button>
          {previewCount !== null && (
            <span className="self-center text-sm text-slate-600">
              <strong>{previewCount}</strong> puzzle{previewCount === 1 ? "" : "s"} match
            </span>
          )}
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
