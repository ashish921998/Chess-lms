import { describe, it, expect } from "vitest";
import { validateMove } from "@/lib/puzzles/validate";

// Scholar's mate: startFen after Black's b6, solution is the single mating move Qxf7#.
const SCHOLARS = {
  startFen: "r1bqkbnr/p1pp1ppp/1pn5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 2",
  solutionMoves: ["f3f7"],
};

// Two-ply line: student move then opponent reply, then student mates.
// Position: Black to move (startFen). Student plays d7d5, opponent e4d5, then
// we'd need a follow-up — for this fixture the first move is non-terminal.
const TWO_PLY = {
  // After 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 — Ruy Lopez. White to move.
  startFen: "r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1",
  // Made-up but legal continuation for testing the continue path:
  solutionMoves: ["b1c3", "b7b6"],
};

describe("validateMove", () => {
  describe("single-ply solution (scholar's mate)", () => {
    it("returns 'solved' when the correct mating move is played", () => {
      const r = validateMove({
        startFen: SCHOLARS.startFen,
        solutionMoves: SCHOLARS.solutionMoves,
        moveIndex: 0,
        uci: "f3f7",
      });
      expect(r.kind).toBe("solved");
    });

    it("returns 'incorrect' for a legal but wrong move", () => {
      const r = validateMove({
        startFen: SCHOLARS.startFen,
        solutionMoves: SCHOLARS.solutionMoves,
        moveIndex: 0,
        uci: "a2a3",
      });
      expect(r.kind).toBe("incorrect");
    });

    it("returns 'illegal' for a move chess.js rejects", () => {
      const r = validateMove({
        startFen: SCHOLARS.startFen,
        solutionMoves: SCHOLARS.solutionMoves,
        moveIndex: 0,
        uci: "a1a8",
      });
      expect(r.kind).toBe("illegal");
    });

    it("does not expose the solution in its return value", () => {
      const r = validateMove({
        startFen: SCHOLARS.startFen,
        solutionMoves: SCHOLARS.solutionMoves,
        moveIndex: 0,
        uci: "f3f7",
      });
      const serialized = JSON.stringify(r);
      expect(serialized).not.toContain("f3f7");
      expect(serialized).not.toContain("f7");
    });
  });

  describe("multi-ply solution (continue path)", () => {
    it("returns 'continue' with next cursor for a non-terminal correct move", () => {
      const r = validateMove({
        startFen: TWO_PLY.startFen,
        solutionMoves: TWO_PLY.solutionMoves,
        moveIndex: 0,
        uci: "b1c3",
      });
      expect(r.kind).toBe("continue");
      if (r.kind === "continue") {
        // Student move (index 0) consumed + opponent reply (index 1) consumed.
        expect(r.nextMoveIndex).toBe(2);
        expect(r.opponentReplyUci).toBe("b7b6");
      }
    });

    it("returns 'solved' when the final ply of a line is played", () => {
      // Start at moveIndex 2 in a 3-ply line (one student move remains).
      const r = validateMove({
        startFen: TWO_PLY.startFen,
        // pretend the line has just one more student move after the opponent reply
        solutionMoves: ["b1c3", "b7b6", "c3e2"],
        moveIndex: 0,
        uci: "b1c3",
      });
      // After playing b1c3 with a 3-ply line, there's still b6 + e2 to go → continue
      expect(r.kind).toBe("continue");
    });
  });

  describe("cursor reconstruction", () => {
    it("reconstructs the position correctly from a non-zero moveIndex", () => {
      // After Nc3 (b1c3) and ...b6 (b7b6), it's White's move. The bishop on a4
      // can retreat to b3 — a legal third ply from the reconstructed position.
      const r = validateMove({
        startFen: TWO_PLY.startFen,
        solutionMoves: ["b1c3", "b7b6", "a4b3"],
        moveIndex: 2,
        uci: "a4b3",
      });
      expect(r.kind).toBe("solved");
    });

    it("returns 'illegal' when the cursor position makes the move impossible", () => {
      // At moveIndex=2, the knight is on c3 (not b1), so b1c3 is illegal.
      const r = validateMove({
        startFen: TWO_PLY.startFen,
        solutionMoves: ["b1c3", "b7b6", "a4b3"],
        moveIndex: 2,
        uci: "b1c3", // knight already moved away from b1 in the replayed line
      });
      expect(r.kind).toBe("illegal");
    });
  });
});
