# Knight Riders Chess Academy — Platform Guide

## What It Is

A private learning platform that connects chess tutors with their students. Students solve Lichess-sourced puzzles calibrated to their skill level. Every move is validated server-side (the solution is never sent to the browser — no cheating). There's a coin economy, Elo rating, streak tracking, badges, and a class leaderboard.

---

## Student Experience

### Sign Up
A student visits the sign-up page, enters a tutor-generated invite code, creates an email/password account, and is immediately linked to the tutor. No admin action needed.

### Dashboard (`/dashboard`)
The home screen shows:
- **Daily goal ring** — a circular progress indicator (default 5 puzzles/day, tutor-adjustable)
- **Active assignments** — puzzle sets the tutor has assigned, with progress bars
- **Quick stats** — current Elo rating, streak length, coin balance
- **Recent activity** — solved/failed puzzles
- **Puzzle browser** — preview available puzzles

### Solving Puzzles (`/practice` or `/sets/[assignmentId]`)
Two ways to solve:

1. **Auto-queue** (`/practice`) — the system picks a puzzle at the student's rating level using a widening Elo window. This is the "just solve" mode.

2. **Assignments** (`/sets/[assignmentId]`) — puzzle sets the tutor has assigned. Two types:
   - **Curated (MANUAL)** — hand-picked puzzles in a fixed order, tracked one-by-one
   - **Adaptive (FILTER)** — criteria-based selection (certain themes + rating range). The system picks puzzles meeting those criteria, and won't repeat within the assignment

The solver is an interactive chess board (drag-and-drop). The student makes moves; each one is validated by the server. They see feedback — correct, incorrect, or solved — immediately.

### Coins & Economy
| Action | Coins |
|--------|-------|
| Solve clean (no hint) | +10 |
| Solve with hint | +5 |
| Buy a hint | -15 |
| Buy a skip | -30 |
| Daily goal bonus | +50 |
| 7-day streak bonus | +100 |
| 30-day streak bonus | +250 |

The ledger is append-only and idempotent — replaying a puzzle cannot award coins twice.

### Rating (Elo)
Students have an in-app Elo rating (starts at 1500). The K-factor decreases as they solve more puzzles (40 → 32 → 24 → 16), so early ratings adjust faster. Replay solves don't affect rating.

Students can also connect their Lichess account to pull in their Lichess puzzle/game ratings (read-only, for reference).

### Streaks & Badges
- **Streaks** — consecutive days meeting the daily goal (timezone-aware)
- **Badges** — `first_solve`, `streak_7`, `streak_30`, `centurion` (100 solves), `sharpshooter` (10 consecutive solves), `comeback` (solve after 3 fails), `theme_master_<theme>` (20 solves on a theme)

### Leaderboard (`/leaderboard`)
Class-wide ranking by lifetime coins. Friendly competition among students of the same tutor.

### Profile (`/profile`)
- Connect/disconnect Lichess account (OAuth)
- Set timezone (important for daily goal boundaries)
- View stats and badges

---

## Tutor Experience

### Roster (`/roster`)
The tutor landing page lists all students with their current rating, active assignment count, and last activity date. From here you can click into any student for detail.

### Adding Students
Generate invite codes from the roster page. Codes are 9-character uppercase (e.g. `CHESSCLASS`). You control max uses and expiration. Share the code with a new student — they sign up and are automatically linked to you.

### Puzzle Sets (`/tutor/sets`)
Puzzle sets are collections of puzzles drawn from the Lichess puzzle library (3M+ puzzles). Two modes:

1. **Curated (MANUAL)** — browse the puzzle library, hand-pick puzzles, arrange them in order. Full control.
2. **Adaptive (FILTER)** — choose themes (e.g. "back rank", "mate in 2") and a rating range. The system selects puzzles matching those criteria when a student starts the assignment. Anti-repeat is scoped to the assignment.

You create sets as drafts, then **publish** them. Publishing creates an immutable snapshot so assigned students always see the same content.

### Puzzle Library (`/library`)
Browse/search the full puzzle database. Filter by rating range and chess themes. Preview any puzzle on a mini-board. Add puzzles directly to a curated set.

### Assigning (`/assign`)
Select a published set and one or more students. Optionally set a due date. Assignments appear on student dashboards immediately.

When you re-assign the same set to the same student, in-progress work is preserved — no double-covering.

### Student Detail (`/students/[id]`)
Per-student deep view showing:
- **Rating trend chart** — Elo over time
- **Theme accuracy table** — solved/attempted/accuracy% per theme
- **Solve history** — recently solved and failed puzzles
- **Assignment progress** — how far through each assignment, with replay counts
- **Activity summary** — streak, solved count, coin balance

### Daily Goals (`/goals`)
Set the daily puzzle target for each student (or all at once with bulk-set). The default is 5. Students see their progress as a ring on the dashboard.

---

## Key Concepts

| Concept | What It Is |
|---------|------------|
| **Puzzle** | A chess position from Lichess with a sequence of best moves. 3M+ available. |
| **Puzzle Set** | A collection of puzzles you create (curated or adaptive). Draft → Publish. |
| **Version** | An immutable snapshot of a published set. Students are assigned to a version. |
| **Assignment** | A version + student(s) + optional due date. Shows up on student dashboard. |
| **Attempt** | A single run through a puzzle. State: PENDING → SOLVED/FAILED/SKIPPED/ABANDONED. |
| **Elo Rating** | In-app skill rating. Separate from Lichess ratings. Starts at 1500. |
| **Daily Goal** | Number of puzzles a student should solve per day (tutor-adjustable). |
| **Coin** | Virtual currency earned by solving. Spent on hints and skips. |

---

## Under The Hood (Trust & Fairness)

- **No client-side solutions** — the correct move sequence is never sent to the browser. Every move posts to the server for validation.
- **Idempotent coins** — solving the same puzzle twice cannot earn coins twice. The ledger uses unique keys and `ON CONFLICT DO NOTHING`.
- **One pending attempt** — a student can only have one puzzle in progress at a time. No parallel guessing.
- **Elo only on first solve** — replaying a puzzle doesn't affect rating.
- **Stale attempts swept** — puzzles abandoned for >2 hours get auto-closed (daily CRON at 04:00 UTC).
- **Cross-tutor isolation** — tutors only see their own students and sets.

---

## For Students (Quick Start)

1. Get an invite code from your tutor
2. Go to https://[app-url]/signup, enter the code, create your account
3. Start solving at `/practice` or check your assignments at `/dashboard`
4. Track your rating, streak, and coins on the dashboard
5. Connect Lichess from your profile page (optional)

---

## For Tutors (Quick Start)

1. Login at `/login` with your tutor credentials
2. Create invite codes from `/roster` and share with students
3. Create puzzle sets at `/tutor/sets/new` (curated or adaptive)
4. Publish them, then assign at `/assign`
5. Monitor progress at `/roster` and drill into students at `/students/[id]`
6. Set daily goals at `/goals`
