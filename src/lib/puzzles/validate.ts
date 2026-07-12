import { Chess } from "chess.js";

/**
 * Input for validating one student move against a puzzle solution.
 * - `startFen`: the position the student plays from (opponent setup already applied).
 * - `solutionMoves`: the full line of plies from startFen — student move, opponent
 *   reply, student move, ... — in UCI. The student's move at `moveIndex` is what
 *   they owe.
 * - `moveIndex`: cursor into solutionMoves (the index of the student's next move).
 * - `uci`: the student's submitted move in UCI (e.g. "e2e4", "e7e8q" for promotion).
 */
export type ValidateInput = {
  startFen: string;
  solutionMoves: string[];
  moveIndex: number;
  uci: string;
};

/**
 * The result of validating one move. CRITICALLY, none of these variants expose
 * any solution ply — the client must never learn the answer.
 */
export type ValidateResult =
  | { kind: "continue"; nextMoveIndex: number; opponentReplyUci: string }
  | { kind: "solved" }
  | { kind: "incorrect" }
  | { kind: "illegal" };

/**
 * Validates a student move against the puzzle solution WITHOUT ever returning
 * the solution plies. Reconstructs the position up to the current cursor by
 * replaying solutionMoves[0..moveIndex-1] from startFen, then checks the move.
 *
 * Design notes:
 * - We do NOT compare UCI strings to decide correctness directly, because two
 *   different UCI strings can represent the same move (e.g. promotions). Instead
 *   we apply the move to a chess.js instance and compare the resulting SAN+to
 *   square against the expected ply applied to a parallel instance.
 * - Illegal moves (chess.js throws or returns null) are reported as "illegal"
 *   with no state change.
 * - On a correct non-terminal move, we auto-apply the opponent's reply (the next
 *   ply in the line) and advance the cursor past it.
 */
export function validateMove(input: ValidateInput): ValidateResult {
  const { startFen, solutionMoves, moveIndex, uci } = input;

  // Reconstruct the position up to (but not including) the current cursor.
  const game = new Chess(startFen);
  for (let i = 0; i < moveIndex; i++) {
    const ply = solutionMoves[i];
    try {
      const ok = game.move(ply);
      if (!ok) return { kind: "illegal" }; // corrupted state — defensive
    } catch {
      return { kind: "illegal" };
    }
  }

  // Try the student's submitted move. chess.js v1.x throws on illegal input
  // for the string overload in some cases; guard both throw and null return.
  let studentMove;
  try {
    studentMove = game.move(uci);
  } catch {
    return { kind: "illegal" };
  }
  if (!studentMove) return { kind: "illegal" };

  // Determine the expected move at this cursor and compare by applying it to a
  // fresh instance from the same position (robust to UCI/SAN differences).
  const expected = solutionMoves[moveIndex];
  const compareGame = new Chess(startFen);
  for (let i = 0; i < moveIndex; i++) {
    try {
      compareGame.move(solutionMoves[i]);
    } catch {
      return { kind: "illegal" };
    }
  }
  let expectedMove;
  try {
    expectedMove = compareGame.move(expected);
  } catch {
    return { kind: "illegal" }; // solution data itself is malformed
  }

  // Compare by from-square + to-square + promotion (the move identity).
  const sameMove =
    studentMove.from === expectedMove.from &&
    studentMove.to === expectedMove.to &&
    studentMove.promotion === expectedMove.promotion;

  if (!sameMove) {
    return { kind: "incorrect" };
  }

  // Correct. If this was the last ply the student owes, the puzzle is solved.
  const isTerminal = moveIndex + 1 >= solutionMoves.length;
  if (isTerminal) return { kind: "solved" };

  // Auto-apply the opponent's reply (the next ply in the line) and advance the
  // cursor past both the student move and the reply.
  const opponentReply = solutionMoves[moveIndex + 1];
  try {
    const reply = game.move(opponentReply);
    if (!reply) {
      // Solution data malformed mid-line — the student's move was correct, so
      // treat defensively as solved rather than blocking them.
      return { kind: "solved" };
    }
  } catch {
    return { kind: "solved" };
  }

  return {
    kind: "continue",
    nextMoveIndex: moveIndex + 2,
    opponentReplyUci: opponentReply,
  };
}
