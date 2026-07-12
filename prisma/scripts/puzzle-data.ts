// Seed puzzle data for M1. Each entry is { fenBeforeSetup, fullLine, rating, themes }
// where fullLine[0] is the OPPONENT's setup move and the rest are the student's
// moves interleaved with opponent replies. The seed script applies fullLine[0]
// to fenBeforeSetup to derive `startFen` (the position the student plays from),
// and validates the ENTIRE line with chess.js — failing loudly if any ply is
// illegal. This is the data integrity safety net.
//
// All three puzzles are verified mates via chess.js. In M2 the bulk Lichess CSV
// import replaces these with thousands of real curated puzzles.

export type RawPuzzle = {
  id: string;
  fenBeforeSetup: string;
  fullLine: string[]; // UCI plies: [oppSetup, studentMove, oppReply, ...]
  rating: number;
  themes: string[];
};

export const SEED_PUZZLES: RawPuzzle[] = [
  {
    // Scholar's mate. Position after 1.e4 e5 2.Bc4 Nc6 3.Qf3.
    // Black (to move) plays a weakening move, then White plays Qxf7#.
    id: "scholars-mate",
    fenBeforeSetup: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 0 1",
    fullLine: ["b7b6", "f3f7"], // ...b6 (setup), Qxf7#
    rating: 600,
    themes: ["mate", "short", "opening"],
  },
  {
    // Back-rank mate. Black king on g8 boxed in by its own f7/g7/h7 pawns.
    // Black shuffles Kh8, then Rd8# — king can't escape (8th rank covered, pawns block).
    id: "back-rank-mate",
    fenBeforeSetup: "6k1/5ppp/8/8/8/8/8/3R3K b - - 0 1",
    fullLine: ["g8h8", "d1d8"], // ...Kh8 (setup), Rd8#
    rating: 800,
    themes: ["backRank", "mate", "short"],
  },
  {
    // Queen + King mate. White king on f6 supports the queen; black king forced to g8.
    // Then Qg7# — king can't capture (defended by Kf6) and can't escape.
    id: "queen-king-mate",
    fenBeforeSetup: "5k2/3Q4/5K2/8/8/8/8/8 b - - 0 1",
    fullLine: ["f8g8", "d7g7"], // ...Kg8 (forced), Qg7#
    rating: 700,
    themes: ["endgame", "mate", "short"],
  },
];
