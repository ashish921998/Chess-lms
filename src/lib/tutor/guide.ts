/**
 * Structured rendering of the platform guide (source of truth: FOR_TUTOR.md).
 *
 * Each section has a stable `id` used as the anchor that tutor feedback
 * attaches to (TutorFeedback.sectionId). Keep ids stable — renaming one
 * strands existing feedback against a phantom section.
 */

export type GuideBlock =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

export type GuideSection = {
  id: string;
  title: string;
  kicker: string;
  blocks: GuideBlock[];
};

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "what-it-is",
    title: "What it is",
    kicker: "Overview",
    blocks: [
      {
        type: "p",
        text: "A private learning platform that connects chess tutors with their students. Students solve Lichess-sourced puzzles calibrated to their skill level. Every move is validated server-side (the solution is never sent to the browser — no cheating). There's a coin economy, Elo rating, streak tracking, badges, and a class leaderboard.",
      },
    ],
  },
  {
    id: "student-signup",
    title: "Sign up",
    kicker: "Student experience",
    blocks: [
      {
        type: "p",
        text: "A student visits the sign-up page, enters a tutor-generated invite code, creates an email/password account, and is immediately linked to the tutor. No admin action needed.",
      },
    ],
  },
  {
    id: "student-dashboard",
    title: "Dashboard",
    kicker: "Student experience · /dashboard",
    blocks: [
      { type: "p", text: "The home screen shows:" },
      {
        type: "list",
        items: [
          "Daily goal ring — a circular progress indicator (default 5 puzzles/day, tutor-adjustable).",
          "Active assignments — puzzle sets the tutor has assigned, with progress bars.",
          "Quick stats — current Elo rating, streak length, coin balance.",
          "Recent activity — solved/failed puzzles.",
          "Puzzle browser — preview available puzzles.",
        ],
      },
    ],
  },
  {
    id: "student-practice",
    title: "Solving puzzles",
    kicker: "Student experience · /practice, /sets/[id]",
    blocks: [
      { type: "p", text: "Two ways to solve:" },
      {
        type: "list",
        items: [
          "Auto-queue (/practice) — the system picks a puzzle at the student's rating level using a widening Elo window. This is the “just solve” mode.",
          "Assignments (/sets/[assignmentId]) — puzzle sets the tutor has assigned. Curated (MANUAL) sets are hand-picked puzzles in a fixed order, tracked one-by-one. Adaptive (FILTER) sets use criteria-based selection (themes + rating range); the system picks puzzles meeting those criteria and won't repeat within the assignment.",
        ],
      },
      {
        type: "p",
        text: "The solver is an interactive chess board (drag-and-drop). The student makes moves; each one is validated by the server. They see feedback — correct, incorrect, or solved — immediately.",
      },
    ],
  },
  {
    id: "student-coins",
    title: "Coins & economy",
    kicker: "Student experience",
    blocks: [
      {
        type: "table",
        headers: ["Action", "Coins"],
        rows: [
          ["Solve clean (no hint)", "+10"],
          ["Solve with hint", "+5"],
          ["Buy a hint", "-15"],
          ["Buy a skip", "-30"],
          ["Daily goal bonus", "+50"],
          ["7-day streak bonus", "+100"],
          ["30-day streak bonus", "+250"],
        ],
      },
      {
        type: "p",
        text: "The ledger is append-only and idempotent — replaying a puzzle cannot award coins twice.",
      },
    ],
  },
  {
    id: "student-rating",
    title: "Rating (Elo)",
    kicker: "Student experience",
    blocks: [
      {
        type: "p",
        text: "Students have an in-app Elo rating (starts at 1500). The K-factor decreases as they solve more puzzles (40 → 32 → 24 → 16), so early ratings adjust faster. Replay solves don't affect rating.",
      },
      {
        type: "p",
        text: "Students can also connect their Lichess account to pull in their Lichess puzzle/game ratings (read-only, for reference).",
      },
    ],
  },
  {
    id: "student-streaks",
    title: "Streaks & badges",
    kicker: "Student experience",
    blocks: [
      {
        type: "list",
        items: [
          "Streaks — consecutive days meeting the daily goal (timezone-aware).",
          "Badges — first_solve, streak_7, streak_30, centurion (100 solves), sharpshooter (10 consecutive solves), comeback (solve after 3 fails), theme_master_<theme> (20 solves on a theme).",
        ],
      },
    ],
  },
  {
    id: "student-leaderboard",
    title: "Leaderboard",
    kicker: "Student experience · /leaderboard",
    blocks: [
      {
        type: "p",
        text: "Class-wide ranking by lifetime coins. Friendly competition among students of the same tutor.",
      },
    ],
  },
  {
    id: "student-profile",
    title: "Profile",
    kicker: "Student experience · /profile",
    blocks: [
      {
        type: "list",
        items: [
          "Connect/disconnect Lichess account (OAuth).",
          "Set timezone (important for daily goal boundaries).",
          "View stats and badges.",
        ],
      },
    ],
  },
  {
    id: "tutor-roster",
    title: "Roster",
    kicker: "Tutor experience · /roster",
    blocks: [
      {
        type: "p",
        text: "The tutor landing page lists all students with their current rating, active assignment count, and last activity date. From here you can click into any student for detail.",
      },
    ],
  },
  {
    id: "tutor-add-students",
    title: "Adding students",
    kicker: "Tutor experience",
    blocks: [
      {
        type: "p",
        text: "Generate invite codes from the roster page. Codes are 9-character uppercase (e.g. CHESSCLASS). You control max uses and expiration. Share the code with a new student — they sign up and are automatically linked to you.",
      },
    ],
  },
  {
    id: "tutor-sets",
    title: "Puzzle sets",
    kicker: "Tutor experience · /tutor/sets",
    blocks: [
      { type: "p", text: "Puzzle sets are collections of puzzles drawn from the Lichess puzzle library (3M+ puzzles). Two modes:" },
      {
        type: "list",
        items: [
          "Curated (MANUAL) — browse the puzzle library, hand-pick puzzles, arrange them in order. Full control.",
          "Adaptive (FILTER) — choose themes (e.g. “back rank”, “mate in 2”) and a rating range. The system selects puzzles matching those criteria when a student starts the assignment. Anti-repeat is scoped to the assignment.",
        ],
      },
      {
        type: "p",
        text: "You create sets as drafts, then publish them. Publishing creates an immutable snapshot so assigned students always see the same content.",
      },
    ],
  },
  {
    id: "tutor-library",
    title: "Puzzle library",
    kicker: "Tutor experience · /library",
    blocks: [
      {
        type: "p",
        text: "Browse/search the full puzzle database. Filter by rating range and chess themes. Preview any puzzle on a mini-board. Add puzzles directly to a curated set.",
      },
    ],
  },
  {
    id: "tutor-assign",
    title: "Assigning",
    kicker: "Tutor experience · /assign",
    blocks: [
      {
        type: "p",
        text: "Select a published set and one or more students. Optionally set a due date. Assignments appear on student dashboards immediately.",
      },
      {
        type: "p",
        text: "When you re-assign the same set to the same student, in-progress work is preserved — no double-covering.",
      },
    ],
  },
  {
    id: "tutor-student-detail",
    title: "Student detail",
    kicker: "Tutor experience · /students/[id]",
    blocks: [
      { type: "p", text: "Per-student deep view showing:" },
      {
        type: "list",
        items: [
          "Rating trend chart — Elo over time.",
          "Theme accuracy table — solved/attempted/accuracy% per theme.",
          "Solve history — recently solved and failed puzzles.",
          "Assignment progress — how far through each assignment, with replay counts.",
          "Activity summary — streak, solved count, coin balance.",
        ],
      },
    ],
  },
  {
    id: "tutor-goals",
    title: "Daily goals",
    kicker: "Tutor experience · /goals",
    blocks: [
      {
        type: "p",
        text: "Set the daily puzzle target for each student (or all at once with bulk-set). The default is 5. Students see their progress as a ring on the dashboard.",
      },
    ],
  },
  {
    id: "concepts",
    title: "Key concepts",
    kicker: "Reference",
    blocks: [
      {
        type: "table",
        headers: ["Concept", "What it is"],
        rows: [
          ["Puzzle", "A chess position from Lichess with a sequence of best moves. 3M+ available."],
          ["Puzzle set", "A collection of puzzles you create (curated or adaptive). Draft → Publish."],
          ["Version", "An immutable snapshot of a published set. Students are assigned to a version."],
          ["Assignment", "A version + student(s) + optional due date. Shows up on student dashboard."],
          ["Attempt", "A single run through a puzzle. PENDING → SOLVED/FAILED/SKIPPED/ABANDONED."],
          ["Elo rating", "In-app skill rating. Separate from Lichess ratings. Starts at 1500."],
          ["Daily goal", "Number of puzzles a student should solve per day (tutor-adjustable)."],
          ["Coin", "Virtual currency earned by solving. Spent on hints and skips."],
        ],
      },
    ],
  },
  {
    id: "trust",
    title: "Under the hood — trust & fairness",
    kicker: "Reference",
    blocks: [
      {
        type: "list",
        items: [
          "No client-side solutions — the correct move sequence is never sent to the browser. Every move posts to the server for validation.",
          "Idempotent coins — solving the same puzzle twice cannot earn coins twice. The ledger uses unique keys and ON CONFLICT DO NOTHING.",
          "One pending attempt — a student can only have one puzzle in progress at a time. No parallel guessing.",
          "Elo only on first solve — replaying a puzzle doesn't affect rating.",
          "Stale attempts swept — puzzles abandoned for >2 hours get auto-closed (daily CRON at 04:00 UTC).",
          "Cross-tutor isolation — tutors only see their own students and sets.",
        ],
      },
    ],
  },
  {
    id: "student-quickstart",
    title: "For students (quick start)",
    kicker: "Quick start",
    blocks: [
      {
        type: "list",
        items: [
          "Get an invite code from your tutor.",
          "Go to the sign-up page, enter the code, create your account.",
          "Start solving at /practice or check your assignments at /dashboard.",
          "Track your rating, streak, and coins on the dashboard.",
          "Connect Lichess from your profile page (optional).",
        ],
      },
    ],
  },
  {
    id: "tutor-quickstart",
    title: "For tutors (quick start)",
    kicker: "Quick start",
    blocks: [
      {
        type: "list",
        items: [
          "Login at /login with your tutor credentials.",
          "Create invite codes from /roster and share with students.",
          "Create puzzle sets at /tutor/sets/new (curated or adaptive).",
          "Publish them, then assign at /assign.",
          "Monitor progress at /roster and drill into students at /students/[id].",
          "Set daily goals at /goals.",
        ],
      },
    ],
  },
];

export const GUIDE_TITLE_LOOKUP = new Map(
  GUIDE_SECTIONS.map((s) => [s.id, s.title])
);
