"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GuideSection } from "@/lib/tutor/guide";

export type FeedbackKind = "COMMENT" | "FEATURE_REQUEST" | "BUG";
export type FeedbackStatus =
  | "OPEN"
  | "ACKNOWLEDGED"
  | "IN_PROGRESS"
  | "DONE"
  | "WONTFIX";

export type FeedbackView = {
  id: string;
  tutorId: string;
  authorName: string;
  sectionId: string;
  sectionTitle: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  body: string;
  devNote: string | null;
  isOwn: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

type Props = {
  sections: GuideSection[];
  feedback: FeedbackView[];
  isDeveloper: boolean;
};

const KIND_META: Record<FeedbackKind, { label: string; cls: string }> = {
  COMMENT: { label: "Comment", cls: "bg-shade text-muted2" },
  FEATURE_REQUEST: { label: "Request", cls: "bg-rust/10 text-rust" },
  BUG: { label: "Bug", cls: "bg-error/10 text-error" },
};

const STATUS_META: Record<FeedbackStatus, { label: string; dot: string; text: string }> = {
  OPEN: { label: "Open", dot: "bg-rust", text: "text-rust" },
  ACKNOWLEDGED: { label: "Acknowledged", dot: "bg-info", text: "text-info" },
  IN_PROGRESS: { label: "In progress", dot: "bg-warning", text: "text-warning" },
  DONE: { label: "Done", dot: "bg-success", text: "text-success" },
  WONTFIX: { label: "Won't fix", dot: "bg-muted2", text: "text-muted2" },
};

const STATUS_ORDER: FeedbackStatus[] = [
  "OPEN",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "DONE",
  "WONTFIX",
];

export function FeedbackBoard({ sections, feedback, isDeveloper }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const bySection = useMemo(() => {
    const map = new Map<string, FeedbackView[]>();
    for (const f of feedback) {
      const arr = map.get(f.sectionId) ?? [];
      arr.push(f);
      map.set(f.sectionId, arr);
    }
    return map;
  }, [feedback]);

  const counts = useMemo(() => {
    const c: Record<FeedbackStatus, number> = {
      OPEN: 0,
      ACKNOWLEDGED: 0,
      IN_PROGRESS: 0,
      DONE: 0,
      WONTFIX: 0,
    };
    for (const f of feedback) c[f.status]++;
    return c;
  }, [feedback]);

  const open = counts.OPEN + counts.ACKNOWLEDGED + counts.IN_PROGRESS;

  function refresh() {
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-9">
      <div className="page-heading">
        <div>
          <div className="page-kicker">
            {isDeveloper ? "Developer console" : "Platform guide"}
          </div>
          <h1>Guide &amp; feedback</h1>
          <p>
            Everything the platform does, section by section. Spot something off,
            want a new feature, or found a bug? Leave a note under the relevant
            section and it goes straight to the developer.
          </p>
        </div>
      </div>

      <section className="surface-card grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-3 lg:grid-cols-5">
        {STATUS_ORDER.map((s) => (
          <div key={s} className="bg-panel/40 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${STATUS_META[s].dot}`} />
              <span className="text-[8px] font-bold uppercase tracking-[.08em] text-muted">
                {STATUS_META[s].label}
              </span>
            </div>
            <strong className="mt-2 block font-serif text-2xl sm:text-3xl">{counts[s]}</strong>
          </div>
        ))}
      </section>

      {isDeveloper && open > 0 && (
        <p className="text-[12px] text-muted">
          <span className="font-bold text-rust">{open}</span> request{open === 1 ? "" : "s"} await action. Use the status menu on each card to triage.
        </p>
      )}

      <div className="space-y-5">
        {sections.map((section) => {
          const items = bySection.get(section.id) ?? [];
          return (
            <Section
              key={section.id}
              section={section}
              items={items}
              isDeveloper={isDeveloper}
              onChanged={refresh}
            />
          );
        })}
      </div>
    </div>
  );
}

function Section({
  section,
  items,
  isDeveloper,
  onChanged,
}: {
  section: GuideSection;
  items: FeedbackView[];
  isDeveloper: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const openCount = items.filter((i) => i.status !== "DONE" && i.status !== "WONTFIX").length;

  return (
    <section id={section.id} className="surface-card scroll-mt-24">
      <div className="flex flex-col gap-1 border-b border-line/70 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="page-kicker !mb-0">{section.kicker}</span>
            <h2 className="mt-1 font-serif text-2xl tracking-tight">{section.title}</h2>
          </div>
          <button
            onClick={() => setOpen((o) => !o)}
            className="secondary-action shrink-0"
            aria-expanded={open}
          >
            {open ? "Cancel" : openCount > 0 ? `${openCount} open` : "Comment"}
          </button>
        </div>
      </div>

      <div className="space-y-4 p-5 sm:p-6">
        <GuideBlocks section={section} />

        {items.length > 0 && (
          <ul className="space-y-3 border-t border-line/70 pt-4">
            {items.map((item) => (
              <li key={item.id}>
                <FeedbackItem item={item} isDeveloper={isDeveloper} onChanged={onChanged} />
              </li>
            ))}
          </ul>
        )}

        {open && <Composer section={section} onChanged={onChanged} onDone={() => setOpen(false)} />}
      </div>
    </section>
  );
}

function GuideBlocks({ section }: { section: GuideSection }) {
  return (
    <div className="space-y-3">
      {section.blocks.map((b, i) => {
        if (b.type === "p") {
          return (
            <p key={i} className="max-w-prose text-[13px] leading-7 text-body">
              {b.text}
            </p>
          );
        }
        if (b.type === "list") {
          return (
            <ul key={i} className="max-w-prose space-y-1.5">
              {b.items.map((it, j) => (
                <li key={j} className="flex gap-2.5 text-[13px] leading-7 text-body">
                  <span className="mt-2.5 inline-block h-1 w-1 shrink-0 rounded-full bg-rust" />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <div key={i} className="max-w-prose overflow-hidden rounded-lg border border-line/70">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-shade/60">
                  {b.headers.map((h) => (
                    <th key={h} className="border-b border-line/70 px-3 py-2 text-[9px] font-bold uppercase tracking-[.08em] text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-line/50 last:border-b-0">
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={`px-3 py-2 text-[12px] ${ci === 0 ? "text-ink" : "text-muted"}`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function Composer({
  section,
  onChanged,
  onDone,
}: {
  section: GuideSection;
  onChanged: () => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<FeedbackKind>("COMMENT");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/tutor/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionId: section.id, kind, body: text }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || `Failed (${res.status})`);
      return;
    }
    setBody("");
    setKind("COMMENT");
    onDone();
    onChanged();
  }

  return (
    <div className="rounded-lg border border-line bg-paper/40 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {(Object.keys(KIND_META) as FeedbackKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`min-h-8 rounded-md px-2.5 text-[10px] font-bold uppercase tracking-[.06em] transition ${
              kind === k ? "bg-ink text-paper" : "bg-shade text-muted2 hover:text-ink"
            }`}
          >
            {KIND_META[k].label}
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder={`Leave a comment, feature request, or bug report about “${section.title}”…`}
        className="w-full resize-y rounded-lg border border-line bg-paper px-3 py-2 text-[13px] leading-6 text-ink placeholder:text-muted2"
      />
      {error && (
        <p className="mt-2 rounded-md border border-error/30 bg-error/5 px-3 py-1.5 text-[12px] text-error">
          {error}
        </p>
      )}
      <div className="mt-2 flex items-center justify-end gap-2">
        <button onClick={onDone} className="secondary-action min-h-8">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy || !body.trim()}
          className="primary-action min-h-8 disabled:opacity-50"
        >
          {busy ? "Posting…" : "Post"}
        </button>
      </div>
    </div>
  );
}

function FeedbackItem({
  item,
  isDeveloper,
  onChanged,
}: {
  item: FeedbackView;
  isDeveloper: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.body);
  const [devDraft, setDevDraft] = useState(item.devNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const km = KIND_META[item.kind];
  const sm = STATUS_META[item.status];

  async function patch(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/tutor/feedback/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || `Failed (${res.status})`);
      return false;
    }
    onChanged();
    return true;
  }

  async function remove() {
    setBusy(true);
    const res = await fetch(`/api/tutor/feedback/${item.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok && res.status !== 404) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || `Failed (${res.status})`);
      return;
    }
    onChanged();
  }

  async function saveEdit() {
    if (!(await patch({ body: draft }))) return;
    setEditing(false);
  }

  async function saveDevNote() {
    await patch({ devNote: devDraft });
  }

  const canEdit = item.isOwn;
  const canDelete = item.isOwn || isDeveloper;

  return (
    <div className="rounded-lg border border-line/70 bg-panel/30 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.06em] ${km.cls}`}>
          {km.label}
        </span>
        <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.06em] ${sm.text}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${sm.dot}`} />
          {sm.label}
        </span>
        <span className="text-[11px] text-muted">
          {item.isOwn ? "You" : item.authorName} · {formatRelative(item.createdAt)}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {canEdit && !editing && (
            <button onClick={() => setEditing(true)} className="min-h-7 rounded-md px-2 text-[10px] font-semibold text-muted hover:text-ink">
              Edit
            </button>
          )}
          {canDelete && (
            <button
              onClick={remove}
              disabled={busy}
              className="min-h-7 rounded-md px-2 text-[10px] font-semibold text-muted hover:text-error disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="mt-2.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full resize-y rounded-md border border-line bg-paper px-3 py-2 text-[13px] leading-6 text-ink"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => { setEditing(false); setDraft(item.body); }} className="secondary-action min-h-7">Cancel</button>
            <button onClick={saveEdit} disabled={busy} className="primary-action min-h-7 disabled:opacity-50">{busy ? "…" : "Save"}</button>
          </div>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-body">{item.body}</p>
      )}

      {item.devNote && !isDeveloper && (
        <div className="mt-2.5 rounded-md border border-info/30 bg-info/5 px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-[.08em] text-info">Developer note</div>
          <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-body">{item.devNote}</p>
        </div>
      )}

      {isDeveloper && (
        <div className="mt-2.5 grid gap-2 border-t border-line/60 pt-2.5 sm:grid-cols-[auto_1fr_auto]">
          <label className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.08em] text-muted">
            Status
            <select
              value={item.status}
              onChange={(e) => patch({ status: e.target.value })}
              disabled={busy}
              className="min-h-8 rounded-md border border-line bg-paper px-2 text-[12px] text-ink disabled:opacity-50"
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{STATUS_META[s].label}</option>
              ))}
            </select>
          </label>
          <input
            value={devDraft}
            onChange={(e) => setDevDraft(e.target.value)}
            placeholder="Reply / resolution note (visible to author)…"
            className="min-h-8 rounded-md border border-line bg-paper px-3 text-[12px] text-ink placeholder:text-muted2"
          />
          <button onClick={saveDevNote} disabled={busy} className="secondary-action min-h-8 disabled:opacity-50">
            {busy ? "…" : "Save note"}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 text-[11px] text-error">{error}</p>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const ms = Date.now() - date.getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}
