# Chess LMS — Milestone 3: Puzzle Sets & Assignments (Design)

> **Parent spec:** `docs/superpowers/specs/2026-07-11-chess-lms-design.md`
> **Status:** Approved in brainstorm (2026-07-13). Implementation plan TBD.

## Goal

Let a tutor assemble puzzle sets (MANUAL = hand-picked, FILTER = criteria-generated per student), publish them as immutable versions, and assign those versions to students or the whole roster. Students see their active assignments on the dashboard and solve them in a version-backed solver. This unlocks the tutor's core teaching loop: assign homework, track progress.

## Scope decisions (from brainstorm)

| Decision | Choice |
|---|---|
| FILTER-mode in M3? | **Yes** — MANUAL + FILTER. |
| FILTER puzzle list | **Per-student live** — criteria intersected with each student's own rating window at solve time; each student gets different puzzles. |
| FILTER progress | **Solve-count toward target** — no fixed item list; assignment completes when solved count reaches `targetCount`. |
| Tutor UI breadth | **Sets + Assign + Roster-lite.** Defer `/goals`, `/invites`, `/students/[id]` to M4. |
| Student discovery | **Assignment list on dashboard** — cards linking to `/sets/[assignmentId]`. |
| Issuance architecture | **Approach A** — generalize the existing inline server-component issuance pattern (`practice/[id]`). No new `/api/puzzles/next` route. |

## Out of scope (deferred)

- `/goals` (dailyGoal management), `/invites` (invite-code UI), `/students/[id]` (per-student detail).
- FILTER "frozen-at-publish" or "freeze-on-first-visit" modes — only per-student-live is built.
- Leaderboard, badges, spend economy (M4/M5).
- Editing a draft after it's been assigned — allowed, but produces a new version; in-flight assignments keep their old version.

## Background: what already exists

The M3 data model is **already in the Prisma schema** from M1: `PuzzleSet`, `PuzzleSetItem`, `PuzzleSetVersion`, `PuzzleSetVersionItem`, `Assignment`, `AssignmentItemProgress`. The assignment-progress write-path for MANUAL sets already exists inside `finalizeSolved` (`src/app/api/attempts/[id]/move/route.ts`): it flips `AssignmentItemProgress.solved`, atomically increments `Assignment.progress`, and the `assignmentItemId` field on `Attempt` already threads the link.

What's missing is the entire tutor application layer (CRUD, publish, assign UI), the student assignment solver, and FILTER-mode semantics. This milestone adds FILTER support to the data model and builds the application layer on top of the existing MANUAL plumbing.

## Data model changes

One migration adds a `mode` discriminator and frozen FILTER fields. The fields are snapshot-copied onto the version at publish time so in-flight assignments are immutable.

```prisma
enum SetMode { MANUAL FILTER }

model PuzzleSet {
  ...existing fields...
  mode            SetMode   @default(MANUAL)
  // FILTER-only (null/empty on MANUAL):
  filterThemes    String[] @default([])
  filterRatingMin Int?
  filterRatingMax Int?
  targetCount     Int?      // how many solves complete a FILTER assignment
}

model PuzzleSetVersion {
  ...existing fields...
  mode            SetMode
  // FILTER-only snapshot (frozen at publish):
  filterThemes    String[] @default([])
  filterRatingMin Int?
  filterRatingMax Int?
  targetCount     Int?
  // MANUAL: items[] materialized as today. FILTER: items[] empty.
}

model Assignment {
  ...existing fields...
  targetCount Int?   // copied from version (FILTER); null for MANUAL
}
```

**Invariants:**
- `PuzzleSet.mode` is immutable after create.
- On MANUAL sets, `filterThemes`/`filterRatingMin`/`filterRatingMax`/`targetCount` are null/empty and the editor rejects setting them (and vice versa for FILTER).
- `PuzzleSetVersionItem` rows exist only for MANUAL versions; FILTER versions have none.
- `AssignmentItemProgress` rows exist only for MANUAL assignments; FILTER assignments have none.
- `Attempt.assignmentItemId` is non-null iff the attempt serves a MANUAL assignment item. `== null` is the FILTER marker.

### MANUAL flow (unchanged from existing design)

Publish materializes `PuzzleSetVersionItem`s from the current draft `PuzzleSetItem`s. Assignment creation materializes `AssignmentItemProgress` (one per version item). Issuance picks the lowest-`order` unsolved item. Finalize flips the item + increments progress. This path already works end-to-end in M1's `finalizeSolved`.

### FILTER flow (new)

FILTER stores criteria, never items. Assignment creation creates the `Assignment` row only (no `AssignmentItemProgress`). The `targetCount` drives completion. At solve time the server derives a puzzle from the criteria × the student's own rating window (§FILTER selection).

## FILTER selection

When a student opens a FILTER assignment, the server runs a filter query that reuses the existing auto-queue fallback ladder (from `src/lib/puzzles/selection.ts`) but adds theme constraints and **assignment-scoped** anti-repeat.

The theme clause is applied **only when `filterThemes` is non-empty**. Postgres's array-overlap operator `&&` returns `false` against an empty array (so a naive `themes && '{}'` would match *no* puzzles). An empty `filterThemes` means "any theme" and must omit the clause entirely.

```sql
-- within the student's rating window [inAppRating ± margin]
SELECT p.id, p.rating, p.themes, p."startFen"
FROM "Puzzle" p
WHERE p.rating BETWEEN $lo AND $hi
  AND ($filterThemes = '{}' OR p.themes && $filterThemes)   -- theme clause; omitted when empty
  AND NOT EXISTS (                                          -- anti-repeat scoped to THIS assignment:
    SELECT 1 FROM "Attempt" a
    WHERE a."puzzleId"     = p.id
      AND a."assignmentId" = $assignmentId
      AND a."studentId"    = $studentId
      AND a.status         = 'SOLVED'
  )
ORDER BY p.popularity DESC
LIMIT 1
```

(The literal `'{}'` comparison is illustrative — the implementer may instead branch the query construction in TS based on whether `filterThemes.length > 0`, which avoids relying on the empty-array literal. Either is fine; the invariant is: empty themes ⇒ no theme filter.)

**Key differences from auto-queue (`selectNextPuzzle`):**
- Optional theme constraint — non-empty `filterThemes` requires overlap; empty matches all themes.
- Anti-repeat is **scoped to the assignment** via SOLVED `Attempt`s, not the global `StudentPuzzle` table. A puzzle solved in auto-queue or a different assignment may still appear here. This lets FILTER assignments reuse puzzles the student has seen elsewhere.
- Same fallback ladder: widen window (±250 → ±400 → ±600), then allow least-recently-solved-in-assignment, then "assignment complete" (different terminal than auto-queue's "queue complete" — here it means the student hit `targetCount`).

`selectNextPuzzle` is generalized to accept an optional filter object `{ themes: string[], ratingMin, ratingMax }` and an optional `assignmentId` so the same ladder serves auto-queue and FILTER. The rating window for a FILTER assignment is still anchored on the student's `inAppRating` (per the per-student-live decision), optionally narrowed by the version's `filterRatingMin`/`Max` if those are tighter than the student's window.

### FILTER progress (finalize)

The existing `finalizeSolved` handles MANUAL (flips `AssignmentItemProgress`, increments progress atomically). A new FILTER branch runs when `assignmentItemId == null` AND the assignment has `targetCount != null`:

```sql
-- atomic increment (safe under concurrent solves on different puzzles)
UPDATE "Assignment" SET progress = progress + 1 WHERE id = $assignmentId;
-- conditional completion — only flips when the count actually reaches target
UPDATE "Assignment" SET completed = true
  WHERE id = $assignmentId
    AND progress >= $targetCount;
```

**Concurrency:** anti-repeat (NOT EXISTS against SOLVED `Attempt`s within the assignment) plus the one-PENDING-per-student index means the same puzzle can't be double-counted. Two parallel solves on *different* puzzles each increment exactly once via the atomic `progress = progress + 1`. The `completed` flip is guarded by `progress >= targetCount`, so a race can only set it true once (idempotent).

`isReplay` (from `StudentPuzzle`) still controls coins/Elo for FILTER puzzles — a puzzle the student solved in auto-queue pays no coins and skips Elo, even though it counts toward the assignment's `targetCount`.

## Assignment issuance flow

Generalizes the existing inline server-component pattern in `practice/[id]` (Approach A). No new `/api/puzzles/next` route.

**Both modes share the PENDING-handling prelude** (per spec §Issuing / verification gate §22):
1. Verify the assignment belongs to the student (`studentId === me.id`), else `notFound()`.
2. Lock the student row (`SELECT … FOR UPDATE`).
3. If a PENDING attempt exists:
   - **Same assignment** → resume it (reconstruct FEN at `moveIndex`, as today).
   - **Different assignment OR auto-queue** → mark it `ABANDONED` (awards nothing), then issue fresh.

**MANUAL issue:** pick lowest-`order` `AssignmentItemProgress` with `solved = false`. Create PENDING `Attempt` with `assignmentId` + `assignmentItemId` set, `isReplay` from `StudentPuzzle`. If no unsolved item remains → render an "assignment complete" state (not a redirect).

**FILTER issue:** run the FILTER selection query. Create PENDING `Attempt` with `assignmentId` set and **`assignmentItemId = null`** (FILTER marker), `isReplay` from `StudentPuzzle`. If the query returns no puzzle (queue exhausted before `targetCount`) → render "assignment complete" / "no more puzzles match."

The `assignmentItemId` null/non-null distinction is what `finalizeSolved` uses to fork progress logic — one field, clean branch.

## Pages & routes

All tutor pages under `(tutor)/`, guarded by `requireTutor()`. Every query scoped by `tutorId`; cross-tutor IDs return 404 (never reveal existence).

### Tutor pages

```
src/app/(tutor)/
├── layout.tsx                       # requireTutor() + simple nav (Sets / Assign / Roster)
├── roster/page.tsx                  # Roster-lite: list students (name, rating, last-active, assignment count)
├── sets/
│   ├── page.tsx                     # list sets: title, mode, isPublished, version count
│   ├── new/page.tsx                 # choose mode → MANUAL or FILTER form
│   └── [setId]/
│       ├── page.tsx                 # edit draft (add/remove/reorder puzzles OR tweak criteria)
│       └── publish action           # materialize version + set isPublished
├── assign/
│   └── page.tsx                     # pick a published version, pick student(s) or "all", due date → create
```

**MANUAL set editor:** add puzzles by ID, or by a theme/rating search; reorder via `order`; remove. Uses `PuzzleSetItem`.
**FILTER set editor:** pick themes (checkbox list sourced from `SELECT DISTINCT unnest(themes) FROM "Puzzle"`), set rating min/max + `targetCount`. Shows a live "preview count" (`SELECT count(*) WHERE themes && $ AND rating BETWEEN $`) so the tutor sees how many puzzles match before publishing.

**Publish** creates a `PuzzleSetVersion`:
- MANUAL → materialize `PuzzleSetVersionItem`s from current draft `PuzzleSetItem`s, in `order`.
- FILTER → copy frozen `filterThemes`/`filterRatingMin`/`filterRatingMax`/`targetCount` onto the version; no items.
- `version` is monotonic per set (`max(version) + 1`). Sets `PuzzleSet.isPublished = true`.

**Assign** creates one `Assignment` per target student, all referencing the chosen version:
- MANUAL → materialize `AssignmentItemProgress` (one per `PuzzleSetVersionItem`).
- FILTER → no items; `targetCount` copied onto the `Assignment`.
- `@@unique([versionId, studentId])` makes re-assign idempotent: if an assignment for `(version, student)` already exists, skip it (no replace — keeps in-flight progress intact).

### Student pages (additions to existing `(student)` group)

```
src/app/(student)/
├── dashboard/page.tsx               # ADD: "Assignments" section — active assignments as cards
└── sets/[assignmentId]/page.tsx     # version-backed solver (MANUAL + FILTER)
```

**Dashboard assignment card:** set title, progress (`7/10` MANUAL or `12/20` FILTER), due date (highlighted if past), "Start" / "Continue" button → `/sets/[assignmentId]`.

**`/sets/[assignmentId]`:** the version-backed solver. Reuses the existing `PuzzleBoard` component unchanged — only the issuance (which puzzle to fetch) differs from `practice/[id]`. Renders assignment title + progress in the header instead of the bare puzzle ID.

### API routes (tutor server actions)

All guarded by `getTutorActor()`, all scoped by `tutorId` (404 if the set isn't yours).

```
src/app/api/tutor/
├── sets/route.ts                    # POST create (mode + fields)
├── sets/[setId]/route.ts            # PATCH update draft, DELETE set
├── sets/[setId]/items/route.ts      # POST add / DELETE remove puzzle (MANUAL only)
├── sets/[setId]/publish/route.ts    # POST → materialize version
└── assignments/route.ts             # POST → create Assignment(s) for a version
```

## Concurrency & integrity

| Race / invariant | Guard |
|---|---|
| Cross-tutor set access | `requireTutor()` + every query scoped by `tutorId` → 404 |
| Cross-student assignment access | assignment `studentId === session student` check → `notFound()` |
| Double-assign same (version, student) | `@@unique([versionId, studentId])`; assign action skips existing |
| FILTER puzzle double-counted | assignment-scoped anti-repeat (NOT EXISTS on SOLVED `Attempt`s) + one-PENDING-per-student |
| FILTER progress lost under parallel solves | atomic `progress = progress + 1` (never count-and-set) |
| FILTER completion double-flip | `completed = true WHERE progress >= targetCount` (idempotent) |
| Edit-after-publish mutates in-flight assignment | versions immutable; assignments reference a version, not the live set |
| Assignment puzzle is client-supplied | puzzle is always server-derived (from item for MANUAL, from filter for FILTER) |

## Verification gates (tests to write before "done")

Extends the parent spec's gate list. Unit-testable items use Vitest; full-flow items use seeded DB state.

1. **MANUAL publish materializes** a version with items matching the draft, in order.
2. **FILTER publish** stores frozen criteria on the version and creates **no** version items.
3. **MANUAL assignment** materializes `AssignmentItemProgress` (one per item); FILTER creates none.
4. **MANUAL issuance** picks the lowest-order unsolved item; `assignmentItemId` set.
5. **FILTER issuance** returns a puzzle matching themes + (student window ∩ version range); `assignmentItemId` is null.
6. **FILTER anti-repeat is assignment-scoped:** a puzzle solved in auto-queue can still appear in a FILTER assignment; a puzzle solved in assignment A is not blocked from assignment B.
7. **FILTER progress increments** on solve; completes at `targetCount` (no overshoot, no double-complete under concurrent solves).
8. **MANUAL progress** still flips items + increments as before (regression).
9. **Context switch (spec §22):** opening assignment A with a PENDING auto-queue attempt abandons it and serves assignment A's puzzle.
10. **Assignment resume:** re-opening `/sets/[assignmentId]` with a PENDING attempt for that assignment resumes at the correct cursor (mid-line FEN), not `startFen`.
11. **Authorization:** a tutor can only CRUD their own sets; a student can only open their own assignments. Cross-access → 404.
12. **Re-assign idempotent:** assigning the same version to the same student twice does not duplicate or reset the assignment.
13. **`isReplay` neutrality in FILTER:** a FILTER puzzle the student already solved globally awards no coins / no Elo, but still counts toward `targetCount`.
14. **FILTER queue exhaustion:** when no puzzle matches (and progress < target), the page surfaces "no more puzzles match" rather than erroring or looping.

## Open questions / future

- **Reassignment policy:** today re-assign is skip-if-exists. A "replace with new version" flow is a natural follow-up.
- **FILTER mode variants:** frozen-at-publish and freeze-on-first-visit (considered and deferred in this brainstorm) could be added as additional `SetMode` values without disrupting per-student-live.
- **Due-date reminders / overdue surfacing** (M4 gamification surface).
- **`/students/[id]` detail** with per-assignment drill-down (deferred with the rest of the roster depth).
