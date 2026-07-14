# Domain glossary — Castle Academy

Shared names for the concepts the code is built around. Use these terms in code,
tests, and design discussion. (Aesthetic/UI vocabulary lives in `DESIGN.md`.)

## Attempt
A student's session against one puzzle. Moves through `PENDING` → a terminal
state (`SOLVED` / `FAILED` / `SKIPPED`). The central entity of the solving loop.

## Finalization
The atomic terminal transition of an **Attempt** — the single operation that
turns a terminal move into its full effect: coins, in-app rating (Elo), daily
progress, streak, badges, and assignment progress, all in one transaction.

Lives in `src/lib/attempts/finalize.ts` as the deep coordinator `recordSolve` /
`recordFail`. It *owns the ordering* of a solve's effects (the invariant that
badges see the post-solve streak, that Elo and coins skip replays). The
gamification and rating modules stay pure evaluators behind that seam — the
coordinator is the only place that composes them. Its return value
(`SolveOutcome` / `FailOutcome`) is the whole record of what happened.

## The Ledger
The append-only record of every coin movement (`CoinTransaction`). One seam —
`src/lib/ledger.ts` — writes all of them. `writeLedgerRow` records an idempotent
row (unique `idempotencyKey`; a duplicate write is a no-op); `creditLedger` adds
the balance increment for earns. Spends debit the balance conditionally
themselves (to enforce sufficiency) and only record their row here.

## The Economy
Every reward and price, in one file — `src/lib/economy.ts`. Solve rewards, goal
bonus, hint/skip costs, streak-tier bonuses. The single place a coin amount
should ever change.

## Assignment (MANUAL / FILTER)
Work a tutor gives a student. **MANUAL** assignments have a fixed ordered list of
puzzle items; **FILTER** assignments target a count of puzzles matching criteria.
Finalization forks on this: MANUAL flips the specific item + completes on the
last one; FILTER caps progress at `targetCount`. Auto-queue (no assignment) is
neutral.

## Replay
Re-solving a puzzle the student already solved. Replays count toward assignment
progress but award no coins and skip Elo — enforced by Finalization via the
solve credit's idempotency key.
