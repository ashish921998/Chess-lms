"use client";

import { useState, useTransition } from "react";

export type GoalRow = {
  id: string;
  displayName: string;
  dailyGoal: number;
};

/**
 * The interactive part of /goals: inline-editable per-student daily-goal inputs
 * + a "set all to N" control. Edits PATCH /api/tutor/goals on blur/enter. The
 * server component passes the initial rows; local state tracks edits + a
 * per-student "saved" flash.
 */
export function GoalsEditor({ rows }: { rows: GoalRow[] }) {
  const [allN, setAllN] = useState(5);
  const [students, setStudents] = useState(rows);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function saveOne(studentId: string, dailyGoal: number) {
    setError(null);
    const res = await fetch("/api/tutor/goals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, dailyGoal }),
    });
    if (res.status === 404) {
      setError("That student is no longer in your roster.");
      return;
    }
    if (!res.ok) {
      setError("Couldn't save — daily goal must be at least 1.");
      return;
    }
    setStudents((prev) =>
      prev.map((s) => (s.id === studentId ? { ...s, dailyGoal } : s))
    );
    flashSaved(studentId);
  }

  async function saveAll(dailyGoal: number) {
    setError(null);
    const res = await fetch("/api/tutor/goals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true, dailyGoal }),
    });
    if (!res.ok) {
      setError("Couldn't save — daily goal must be at least 1.");
      return;
    }
    setStudents((prev) => prev.map((s) => ({ ...s, dailyGoal })));
    flashSaved("all");
  }

  function flashSaved(key: string) {
    setSavedId(key);
    startTransition(() => {
      setTimeout(() => setSavedId((cur) => (cur === key ? null : cur)), 1200);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end gap-3 border border-line bg-panel px-4 py-3">
        <label
          htmlFor="set-all"
          className="text-[11px] uppercase tracking-[0.1em] text-muted"
        >
          Set all to
        </label>
        <input
          id="set-all"
          type="number"
          min={1}
          value={allN}
          onChange={(e) => setAllN(Number(e.target.value))}
          className="w-20 border border-line bg-paper px-2 py-1.5 text-[13px] text-ink focus:outline-none focus:border-ink"
        />
        <button
          type="button"
          onClick={() => saveAll(allN)}
          className="bg-ink text-paper px-4 py-2 text-[11px] font-medium uppercase tracking-[0.07em] hover:bg-[#3a3630]"
        >
          Apply to roster
        </button>
        {savedId === "all" && (
          <span className="text-[10px] uppercase tracking-[0.06em] text-success">Saved</span>
        )}
      </div>

      {error && (
        <p className="text-[12px] text-error border border-line bg-panel px-3 py-2">{error}</p>
      )}

      <div className="border border-line bg-panel">
        <div className="grid grid-cols-[1fr_6rem] gap-4 px-4 py-2 text-[10px] uppercase tracking-[0.1em] text-muted border-b border-line">
          <div>Student</div>
          <div className="text-right">Daily goal</div>
        </div>
        <ul className="divide-y divide-line">
          {students.map((s) => (
            <li key={s.id} className="grid grid-cols-[1fr_6rem] gap-4 px-4 py-3 items-center">
              <div className="text-[13px]">{s.displayName}</div>
              <div className="flex items-center justify-end gap-2">
                <InlineGoalInput value={s.dailyGoal} onSave={(n) => saveOne(s.id, n)} />
                {savedId === s.id && (
                  <span className="text-[9px] uppercase tracking-[0.06em] text-success">Saved</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** A number input that commits on blur or Enter. */
function InlineGoalInput({
  value,
  onSave,
}: {
  value: number;
  onSave: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  function commit() {
    const n = Number(draft);
    if (Number.isInteger(n) && n >= 1 && n !== value) {
      onSave(n);
    } else {
      setDraft(String(value)); // revert invalid/unchanged
    }
  }

  return (
    <input
      type="number"
      min={1}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="w-16 text-right border border-line bg-paper px-2 py-1.5 font-mono text-[13px] text-ink focus:outline-none focus:border-ink"
    />
  );
}
