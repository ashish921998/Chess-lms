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
- Editing a draft after it's been assigned — see "Editing after publish" below. In short: editing a published set is allowed (the draft mutates freely), but in-flight assignments keep their old immutable version; only newly-created assignments pick up a fresh publish.
- **FILTER completion bonus / power-up economy** — the all-replay edge case is noted (§FILTER replay UX) but no completion bonus is wired in M3; that lands with the spend economy in M5.

## Background: what already exists

The M3 data model is **already in the Prisma schema** from M1: `PuzzleSet`, `PuzzleSetItem`, `PuzzleSetVersion`, `PuzzleSetVersionItem`, `Assignment`, `AssignmentItemProgress`. The assignment-progress write-path for MANUAL sets **partially** exists inside `finalizeSolved` (`src/app/api/attempts/[id]/move/route.ts`): it flips `AssignmentItemProgress.solved` and atomically increments `Assignment.progress`, and the `assignmentItemId` field on `Attempt` already threads the link.

**Gap (verified against current code):** `finalizeSolved` never flips `Assignment.completed = true` for MANUAL assignments — the item flip and progress increment are there, but the completion check is missing. So MANUAL assignments track progress but never register as complete. **M3 fills this** (see Gap-fills). This means M3's MANUAL path is a *fix-and-extend*, not a pure reuse.

What's missing is the entire tutor application layer (CRUD, publish, assign UI), the student assignment solver, FILTER-mode semantics, and the MANUAL completion gap-fill. This milestone adds FILTER support to the data model, fills the MANUAL gap, and builds the application layer.

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

### MANUAL flow (gap-filled in M3)

Publish materializes `PuzzleSetVersionItem`s from the current draft `PuzzleSetItem`s. Assignment creation materializes `AssignmentItemProgress` (one per version item). Issuance picks the lowest-`order` unsolved item. Finalize flips the item + atomically increments `Assignment.progress`.

The item-flip and progress-increment are already implemented in `finalizeSolved`. **M3 fills the completion gap** (below).

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

`selectNextPuzzle` is generalized to accept an optional filter object `{ themes: string[], ratingMin, ratingMax }` and an optional `assignmentId` so the same ladder serves auto-queue and FILTER. The rating window for a FILTER assignment is anchored on the student's `inAppRating` (per the per-student-live decision) **intersected** with the version's `[filterRatingMin, filterRatingMax]` when both are present: `lo = max(inAppRating - margin, filterRatingMin)`, `hi = min(inAppRating + margin, filterRatingMax)`.

**Fallback when the intersection is empty (Blocker guard).** If `filterRatingMin`/`Max` don't overlap the student's window — e.g. filter `[800, 1000]` vs a student rated 2000 (window `[1750, 2250]`) gives `lo = 1750 > hi = 1000` — widening the student margin makes `lo` higher, never reaching the filter range. The student would be stuck. The fallback ladder's **final step therefore drops the student window and uses only `[filterRatingMin, filterRatingMax]`** before declaring exhaustion. The student rating anchors the *initial* window for level-appropriateness, but an explicit tutor constraint wins. Ladder:
1. Intersected window `[max, min]` (if non-empty) at ±250.
2. Widen student margin (±400, ±600), re-intersecting each step.
3. **If intersection is still empty (or at any point becomes so): query `[filterRatingMin, filterRatingMax]` alone**, ignoring the student window. Least-recently-solved-in-assignment as tiebreak.
4. Only if *that* is empty → "assignment exhausted" (no more puzzles match the tutor's range).

### FILTER progress (finalize)

`finalizeSolved` forks on the assignment type. The fork condition must be explicit to disambiguate from auto-queue attempts (which have `assignmentId == null` **and** `assignmentItemId == null`):

- `assignmentItemId != null` → **MANUAL** branch.
- `assignmentId != null && assignmentItemId == null && assignment.targetCount != null` → **FILTER** branch.
- `assignmentId == null` → auto-queue; no assignment progress (current behavior).

The existing MANUAL code path (item flip + atomic `progress` increment) is preserved, but M3 **fills a gap**: it also flips `completed` (see Gap-fills below).

The FILTER branch:

```sql
-- atomic increment, CAPPED at targetCount so progress can never overshoot
UPDATE "Assignment"
  SET progress = LEAST(progress + 1, $targetCount)
  WHERE id = $assignmentId;
-- conditional completion — idempotent; the LEAST cap makes progress == targetCount exact
UPDATE "Assignment" SET completed = true
  WHERE id = $assignmentId
    AND progress >= $targetCount
    AND completed = false;
```

**Concurrency:** anti-repeat (NOT EXISTS against SOLVED `Attempt`s within the assignment) plus the one-PENDING-per-student index means the same puzzle can't be double-counted. Two parallel solves on *different* puzzles each increment exactly once. Without the cap, two solves landing at `progress = targetCount - 1` could both commit `progress + 1`, overshooting to `targetCount + 1`. `LEAST(progress + 1, targetCount)` makes `progress` exact; the `completed = false` guard makes the completion flip idempotent.

`isReplay` (from `StudentPuzzle`) still controls coins/Elo for FILTER puzzles — a puzzle the student solved in auto-queue pays no coins and skips Elo, even though it counts toward the assignment's `targetCount`.

### Gap-fills in `finalizeSolved` (M3 must do these)

1. **MANUAL completion (Bug fix).** After the existing item flip + atomic `progress` increment, flip `completed` conditionally against the version's item count — never a count-and-set:
   ```sql
   UPDATE "Assignment" SET completed = true
     WHERE id = $assignmentId
       AND completed = false
       AND progress = (
         SELECT count(*) FROM "PuzzleSetVersionItem" WHERE "versionId" = $versionId
       );
   ```
   This matches the parent spec §Finalize step 5 and was missing in M1.
2. **Fork on the full assignment signature.** The finalize assignment-progress branch must disambiguate three cases, not two (auto-queue attempts have `assignmentId == null` and would otherwise hit a null `targetCount` lookup):
   - `assignmentItemId != null` → MANUAL (item flip + progress + completion check above).
   - `assignmentId != null && assignmentItemId == null && targetCount != null` → FILTER (LEAST-capped increment + completion check).
   - `assignmentId == null` → auto-queue; skip assignment progress entirely (unchanged).

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

### FILTER replay UX (noted, not solved in M3)

Because FILTER anti-repeat is assignment-scoped, a puzzle the student solved in auto-queue can appear in a FILTER assignment — and as a *replay* it awards no coins and no Elo while still counting toward `targetCount`. A student who's done a lot of daily practice could finish a 20-puzzle FILTER assignment with zero coin gain. This is logically consistent (the assignment measures completion, not reward), but feels bad.

M3 surfaces this with a small UI affordance rather than a rewards change: the assignment solver shows "(replay)" next to such puzzles (the existing `practice/[id]` page already does this), and the dashboard card distinguishes "Completed" from "Completed — N replays" so the student understands why coins were low. A true completion bonus (e.g. `+50 ASSIGNMENT_COMPLETE`, keyed `assign:{studentId}:{assignmentId}` via the existing ON CONFLICT pattern) is deferred to the spend/rewards milestone (M5).

## Pages & routes

All tutor pages under `(tutor)/`, guarded by `requireTutor()`. Every query scoped by `tutorId`; cross-tutor IDs return 404 (never reveal existence).

### Tutor pages

```
src/app/(tutor)/
├── layout.tsx                       # requireTutor() + simple nav (Sets / Assign / Roster)
├── roster/page.tsx                  # Roster-lite: list students (name, rating, last-active) + per-student
│                                    #   assignment summary: active count, and per-assignment progress
│                                    #   (MANUAL: solved/total items; FILTER: progress/targetCount, completed?)
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

**Editing after publish.** A set's draft (`PuzzleSet` + `PuzzleSetItem`s, or FILTER criteria) is always mutable — `isPublished` does not lock it. Editing a published set does **not** unpublish it and does **not** touch existing versions (they're immutable snapshots). To roll the edit out to students, the tutor publishes again, which creates a *new* `PuzzleSetVersion` (`version + 1`); new assignments created from that set pick up the latest version, while in-flight assignments keep whatever version they were created against. The assign UI shows the set's current latest version.

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
| FILTER progress lost / overshoot under parallel solves | atomic `LEAST(progress + 1, targetCount)` (capped, never count-and-set) |
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
7. **FILTER progress is exact and capped:** after `n` solves, `progress = min(n, targetCount)`, never greater than `targetCount`; `completed` flips to true exactly once (the `completed = false` guard). Assert the LEAST cap holds even under concurrent solves landing at `targetCount - 1`.
8. **MANUAL completion (gap-fill):** solving the last unsolved item flips `Assignment.completed = true` exactly once; solving a non-last item does not. (Regression + new gap-fill.)
9. **MANUAL progress** still flips items + increments as before (regression — item flip + atomic `progress` increment untouched).
10. **FILTER range outside student window still serves** (Issue 1 guard): a FILTER assignment with `[filterRatingMin, filterRatingMax]` disjoint from the student's window serves puzzles from the filter range (the fallback drops the student-window constraint), rather than getting stuck.
11. **Context switch (spec §22):** opening assignment A with a PENDING auto-queue attempt abandons it and serves assignment A's puzzle.
12. **Assignment resume:** re-opening `/sets/[assignmentId]` with a PENDING attempt for that assignment resumes at the correct cursor (mid-line FEN), not `startFen`.
13. **Authorization:** a tutor can only CRUD their own sets; a student can only open their own assignments. Cross-access → 404.
14. **Re-assign idempotent:** assigning the same version to the same student twice does not duplicate or reset the assignment.
15. **`isReplay` neutrality in FILTER:** a FILTER puzzle the student already solved globally awards no coins / no Elo, but still counts toward `targetCount`.
16. **FILTER queue exhaustion:** when no puzzle matches (and progress < target), the page surfaces "no more puzzles match" rather than erroring or looping.
17. **Auto-queue unaffected by FILTER finalize branch:** solving an auto-queue attempt (`assignmentId == null`) does not hit the FILTER or MANUAL progress branches (Issue 4 guard).

## Open questions / future

- **Reassignment policy:** today re-assign is skip-if-exists. A "replace with new version" flow is a natural follow-up.
- **FILTER mode variants:** frozen-at-publish and freeze-on-first-visit (considered and deferred in this brainstorm) could be added as additional `SetMode` values without disrupting per-student-live.
- **Due-date reminders / overdue surfacing** (M4 gamification surface).
- **`/students/[id]` detail** with per-assignment drill-down (deferred with the rest of the roster depth).
