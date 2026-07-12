# Chess Tutor LMS

A learning management system for a chess tutor and their students. Students solve Lichess puzzles calibrated to their level; the solve is validated server-side; coins are awarded through an idempotent ledger.

## Status

**Milestone 1 (core solve loop)** — complete. Students sign up with an invite code, log in, solve puzzles on an interactive board, and earn coins. The tutor is seeded administratively.

Lichess OAuth, the auto-queue, tutor puzzle-set CRUD, gamification (streaks/badges/leaderboard), and the spend economy land in later milestones. See `docs/superpowers/specs/2026-07-11-chess-lms-design.md` and `docs/superpowers/plans/`.

## Quick start

```bash
pnpm install
pnpm db:up          # Postgres in Docker (port 5433)
cp .env.example .env  # then set AUTH_SECRET (openssl rand -base64 32)
pnpm db:migrate
pnpm db:seed        # creates tutor@example.com / password123 + invite CHESSCLASS + 3 puzzles
pnpm dev
```

Open http://localhost:3000.

- **Tutor login:** `tutor@example.com` / `password123` (redirects to `/roster` — not built in M1)
- **Student signup:** `/signup` with invite code `CHESSCLASS`

## Tests

```bash
pnpm db:up          # ensure Postgres is running
pnpm test
```

## Architecture

- **Server-authoritative solve:** the client posts a move + cursor; the server validates against the stored solution and conditionally finalizes the attempt. The solution is never sent to the browser.
- **Idempotent rewards:** coin credits are keyed on a puzzle-level entitlement (`solve:{studentId}:{puzzleId}`), so abandoning and re-solving a puzzle can't double-credit. Ledger inserts use `ON CONFLICT DO NOTHING RETURNING`.
- **Concurrency:** parallel move submissions are serialized by a conditional `WHERE status = 'PENDING' AND revision = expected` update. One PENDING attempt per student (partial unique index).
- **Rating:** documented Elo with K-factor. Replay solves skip Elo entirely. External (Lichess) and in-app ratings are kept separate.

See the [design spec](docs/superpowers/specs/2026-07-11-chess-lms-design.md) for the full model.

## Tech stack

- Next.js 16 (App Router) + TypeScript
- PostgreSQL 16 (Docker) via Prisma 7 (pg driver adapter)
- Better Auth (email/password, server-only role field)
- react-chessboard v5 + chess.js v1.4
- Tailwind CSS v4
- Vitest
