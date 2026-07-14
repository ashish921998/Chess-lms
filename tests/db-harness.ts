import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

/**
 * The transaction client handed to a `$transaction(async (tx) => …)` callback.
 * Re-exported from the canonical app definition so the app and tests share one
 * source of truth.
 */
export type { PrismaTransaction } from "@/lib/puzzles/transaction-client";
import type { PrismaTransaction } from "@/lib/puzzles/transaction-client";

/**
 * DB integration-test harness.
 *
 * Tests run against `TEST_DATABASE_URL` (a separate `chess_test` database, see
 * `docker-compose.yml` + `db/init/01-create-test-db.sql`). Each test body runs
 * inside a single transaction that is ALWAYS rolled back, so tests are isolated
 * and never leave state behind. The schema must be pushed to `chess_test` once
 * before running (see tests/README.md).
 *
 * Because the test owns the transaction, logic under test must accept an
 * injected `tx` (the `PrismaTransaction` client) — that's why the M3 slice
 * extracts `recordSolve(tx, ...)` etc. Calling code that opens its OWN
 * `db.$transaction` would commit and defeat the rollback, so those wrappers are
 * split into `*Tx` inner functions the harness can drive.
 */

let _pool: Pool | null = null;
let _client: PrismaClient | null = null;

function testDb(): PrismaClient {
  if (_client) return _client;
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Copy .env (which defines it) or export it before running tests."
    );
  }
  _pool = new Pool({ connectionString: url });
  const adapter = new PrismaPg(_pool);
  _client = new PrismaClient({ adapter });
  return _client;
}

/** The shared test PrismaClient (bound to TEST_DATABASE_URL). */
export const db = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    return Reflect.get(testDb() as object, prop);
  },
});


/**
 * Run a test body inside a transaction that rolls back unconditionally. The
 * body receives the transaction client (`tx`); pass it into the `*Tx` form of
 * the function under test. If the body throws, the transaction rolls back and
 * the error propagates (so the test fails).
 *
 * Note: Postgres savepoints back the nested transaction, so a body that itself
 * issues SAVEPOINTs (Prisma's nested interactive transactions) works, but code
 * under test should use the injected `tx` directly rather than opening a fresh
 * `db.$transaction` — that would commit outside our rollback scope.
 */
export async function withRollbackTx<T>(
  fn: (tx: PrismaTransaction) => Promise<T>
): Promise<T> {
  const client = testDb();
  return client.$transaction(async (tx) => {
    try {
      return await fn(tx);
    } finally {
      // Force an error so the interactive transaction rolls back regardless of
      // what the body did. Prisma rolls back an interactive $transaction only
      // when it rejects; throwing here guarantees rollback even if the body
      // only performed reads.
      throw new Error("__rollback__");
    }
  }).catch((e: unknown) => {
    if (e instanceof Error && e.message === "__rollback__") return undefined as unknown as T;
    throw e;
  });
}

/**
 * Minimal seeded fixture: a tutor, a student of that tutor, and a handful of
 * puzzles spanning ratings/themes. Created inside the caller's transaction so
 * it rolls back with the test. Returns IDs the test can wire into its own rows.
 *
 * Puzzle FENs/solutions are real, legal, single-ply mates so any test that
 * ends up exercising the solver path validates cleanly.
 */
export async function seedFixture(tx: PrismaTransaction): Promise<Fixture> {
  const tutorUser = await tx.user.create({
    data: {
      id: "ft-user",
      email: "fixture-tutor@example.com",
      name: "Fixture Tutor",
      role: "TUTOR",
      emailVerified: true,
      tutor: { create: { id: "ft-tutor" } },
    },
    include: { tutor: true },
  });

  const studentUser = await tx.user.create({
    data: {
      id: "fs-user",
      email: "fixture-student@example.com",
      role: "STUDENT",
      emailVerified: true,
      student: {
        create: {
          id: "fs-student",
          tutorId: tutorUser.tutor!.id,
          displayName: "Fixture Student",
          inAppRating: 1500,
        },
      },
    },
    include: { student: true },
  });

  // A second student for cross-student assertions.
  const student2User = await tx.user.create({
    data: {
      id: "fs2-user",
      email: "fixture-student2@example.com",
      role: "STUDENT",
      emailVerified: true,
      student: {
        create: {
          id: "fs2-student",
          tutorId: tutorUser.tutor!.id,
          displayName: "Fixture Student 2",
          inAppRating: 1500,
        },
      },
    },
    include: { student: true },
  });

  // A second tutor for cross-tutor 404 assertions.
  const tutor2User = await tx.user.create({
    data: {
      id: "ft2-user",
      email: "fixture-tutor2@example.com",
      role: "TUTOR",
      emailVerified: true,
      tutor: { create: { id: "ft2-tutor" } },
    },
    include: { tutor: true },
  });

  const puzzles = await Promise.all(
    PUZZLE_FIXTURES.map((p) => tx.puzzle.create({ data: p }))
  );

  return {
    tutorId: tutorUser.tutor!.id,
    tutor2Id: tutor2User.tutor!.id,
    studentId: studentUser.student!.id,
    student2Id: student2User.student!.id,
    puzzles,
  };
}

export type Fixture = {
  tutorId: string;
  tutor2Id: string;
  studentId: string;
  student2Id: string;
  puzzles: Array<{
    id: string;
    rating: number;
    themes: string[];
  }>;
};

/**
 * Four puzzles with varied ratings/themes. All are legal single-ply mates from
 * a real position so the solver/validate path can be exercised if needed.
 * `id`s are stable so tests can reference them by name.
 *
 * Position (white to move, queen takes f7 mate):
 *   r1bqkbnr/p1pp1ppp/1pn5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 2
 */
const START_FEN =
  "r1bqkbnr/p1pp1ppp/1pn5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 2";

const PUZZLE_FIXTURES = [
  {
    id: "pz-1000-backRank",
    startFen: START_FEN,
    solutionMoves: ["f3f7"],
    rating: 1000,
    themes: ["backRank", "mate"],
    popularity: 100,
  },
  {
    id: "pz-1100-fork",
    startFen: START_FEN,
    solutionMoves: ["f3f7"],
    rating: 1100,
    themes: ["fork", "advantage"],
    popularity: 90,
  },
  {
    id: "pz-1500-mate",
    startFen: START_FEN,
    solutionMoves: ["f3f7"],
    rating: 1500,
    themes: ["mate"],
    popularity: 80,
  },
  {
    id: "pz-1900-fork",
    startFen: START_FEN,
    solutionMoves: ["f3f7"],
    rating: 1900,
    themes: ["fork"],
    popularity: 70,
  },
];
