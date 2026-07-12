import "dotenv/config";
import { Chess } from "chess.js";
import bcrypt from "bcryptjs";
import { SEED_PUZZLES, type RawPuzzle } from "./puzzle-data";
import { db as prisma } from "../../src/lib/db";

const TUTOR_EMAIL = "tutor@example.com";
const TUTOR_PASSWORD = "password123";
const TUTOR_NAME = "Coach Demo";
const INVITE_CODE = "CHESSCLASS";

async function seedTutor() {
  const passwordHash = await bcrypt.hash(TUTOR_PASSWORD, 10);

  const tutorUser = await prisma.user.upsert({
    where: { email: TUTOR_EMAIL },
    update: {},
    create: {
      id: "seed-tutor-user",
      email: TUTOR_EMAIL,
      name: TUTOR_NAME,
      role: "TUTOR",
      emailVerified: true,
      accounts: {
        create: {
          id: "seed-tutor-account",
          providerId: "credential",
          accountId: TUTOR_EMAIL,
          password: passwordHash,
        },
      },
      tutor: { create: { id: "seed-tutor" } },
    },
    include: { tutor: true },
  });

  const invite = await prisma.inviteCode.upsert({
    where: { code: INVITE_CODE },
    update: {},
    create: {
      code: INVITE_CODE,
      tutorId: tutorUser.tutor!.id,
      maxUses: 50,
    },
  });

  return { tutorUser, invite };
}

/**
 * Validates a raw puzzle's full move line with chess.js, applying the opponent's
 * setup move to derive startFen. Returns the derived Puzzle fields, or throws
 * with a descriptive error if any ply is illegal.
 */
function buildPuzzle(raw: RawPuzzle): {
  id: string;
  startFen: string;
  solutionMoves: string[];
  rating: number;
  themes: string[];
} {
  const game = new Chess(raw.fenBeforeSetup);

  // Apply opponent setup move (first ply of the line). chess.js v1.4 parses
  // plain UCI strings directly via the string overload.
  const setupUci = raw.fullLine[0];
  const setupMove = game.move(setupUci);
  if (!setupMove) {
    throw new Error(`Puzzle ${raw.id}: illegal setup move "${setupUci}" from FEN ${raw.fenBeforeSetup}`);
  }
  const startFen = game.fen();
  const solutionMoves = raw.fullLine.slice(1); // student move + opponent replies

  // Validate the remaining line from startFen. The student's first move must be
  // legal AND (for these seed puzzles) deliver checkmate or continue the line.
  const verifier = new Chess(startFen);
  for (const ply of solutionMoves) {
    const ok = verifier.move(ply);
    if (!ok) {
      throw new Error(`Puzzle ${raw.id}: illegal ply "${ply}" in solution from ${startFen}`);
    }
  }

  return {
    id: raw.id,
    startFen,
    solutionMoves,
    rating: raw.rating,
    themes: raw.themes,
  };
}

async function seedPuzzles() {
  for (const raw of SEED_PUZZLES) {
    const puzzle = buildPuzzle(raw); // throws loudly on invalid data
    await prisma.puzzle.upsert({
      where: { id: puzzle.id },
      update: {
        startFen: puzzle.startFen,
        solutionMoves: puzzle.solutionMoves,
        rating: puzzle.rating,
        themes: puzzle.themes,
      },
      create: puzzle,
    });
    console.log(`  ✓ puzzle ${puzzle.id} (rating ${puzzle.rating}, ${puzzle.solutionMoves.length} solution plies)`);
  }
}

async function main() {
  console.log("Seeding tutor...");
  const { tutorUser } = await seedTutor();
  console.log(`  ✓ tutor ${TUTOR_EMAIL} (id ${tutorUser.tutor!.id}), invite ${INVITE_CODE}`);

  console.log("Seeding puzzles...");
  await seedPuzzles();

  console.log("\nSeed complete.");
  console.log(`  Login as tutor: ${TUTOR_EMAIL} / ${TUTOR_PASSWORD}`);
  console.log(`  Student invite code: ${INVITE_CODE}`);
  console.log(`  Puzzles: ${SEED_PUZZLES.length}`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
