"use client";

import { useState, useCallback } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";

type BoardStatus = "playing" | "incorrect" | "failed" | "solved";

type Props = {
  attemptId: string;
  startFen: string;
  solutionLength: number;
  initialRevision: number;
};

/**
 * Interactive puzzle board. The client NEVER knows the solution — it posts each
 * move to the server, which validates and responds with continue/incorrect/
 * illegal/solved. The client only tracks the board position (via chess.js) and
 * the revision cursor the server expects.
 */
export function PuzzleBoard({ attemptId, startFen, initialRevision }: Props) {
  const [game, setGame] = useState(() => new Chess(startFen));
  const [revision, setRevision] = useState(initialRevision);
  const [status, setStatus] = useState<BoardStatus>("playing");
  const [message, setMessage] = useState("Find the best move");
  const [waiting, setWaiting] = useState(false);

  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare, piece }: { sourceSquare: string; targetSquare: string | null; piece: { pieceType: string } }): boolean => {
      if (status !== "playing" || waiting || !targetSquare) return false;

      // Build the UCI move string, including promotion for pawn pushes to the last rank.
      const isPawn = piece.pieceType[1] === "P";
      const targetRank = targetSquare[1];
      const needsPromotion = isPawn && (targetRank === "8" || targetRank === "1");
      const uci = sourceSquare + targetSquare + (needsPromotion ? "q" : "");

      // Optimistically check legality locally (chess.js) so illegal drops snap back.
      const testGame = new Chess(game.fen());
      let testMove;
      try {
        testMove = testGame.move(uci);
      } catch {
        testMove = null;
      }
      if (!testMove) return false; // illegal — snap back

      // Submit to the server for authoritative validation.
      setWaiting(true);
      fetch(`/api/attempts/${attemptId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ move: uci, expectedRevision: revision }),
      })
        .then((r) => r.json())
        .then((body) => {
          if (body.status === "illegal") {
            setMessage("Illegal move");
            // Don't change the board — snap back happened already (we didn't commit testGame).
          } else if (body.status === "incorrect") {
            setMessage(`Not the best move (${body.failCount}/${2} tries)`);
            setRevision(body.expectedRevision ?? revision + 1);
            // The board stays as-is — the move was legal but wrong, so it's on the board.
            // Actually we should commit the wrong move so the student sees their position,
            // then they can try again from the same spot. But the server didn't advance
            // the solution cursor, so the board should reflect the wrong move.
            setGame(new Chess(testGame.fen()));
          } else if (body.status === "failed") {
            setGame(new Chess(testGame.fen()));
            setStatus("failed");
            setMessage("Out of tries — the puzzle is complete.");
          } else if (body.status === "solved") {
            setGame(new Chess(testGame.fen()));
            setStatus("solved");
            setMessage(body.coinsAwarded > 0 ? `Solved! +${body.coinsAwarded} coins` : "Solved! (replay — no coins)");
          } else if (body.status === "continue") {
            // Apply the student's move + the opponent's auto-reply.
            testGame.move(body.opponentMove);
            setGame(new Chess(testGame.fen()));
            setRevision(body.expectedRevision);
            setMessage("Good move — keep going");
          } else if (body.error === "revision_mismatch") {
            setMessage("Position changed — refreshing...");
            setRevision(body.expectedRevision);
            // The client should refetch the attempt state. For M1, reload the page.
            setTimeout(() => window.location.reload(), 800);
          } else if (body.error === "attempt_finalized") {
            setStatus("failed");
            setMessage("This puzzle was already completed.");
          }
        })
        .catch(() => setMessage("Connection error — try again"))
        .finally(() => setWaiting(false));

      return true; // accept the drop (board shows it; server is authoritative)
    },
    [game, status, waiting, revision, attemptId]
  );

  return (
      <div className="space-y-4">
      <div className="flex flex-col items-center gap-3">
        <div style={{ maxWidth: 420, width: "100%" }}>
          <Chessboard
            options={{
              position: game.fen(),
              onPieceDrop,
              allowDragging: status === "playing" && !waiting,
              boardStyle: { borderRadius: "4px" },
            }}
          />
        </div>
        <div className="flex items-center gap-3">
          <p
            className={`font-medium ${
              status === "solved"
                ? "text-green-700"
                : status === "failed"
                ? "text-red-700"
                : "text-slate-700"
            }`}
          >
            {message}
          </p>
          {waiting && <span className="text-sm text-slate-400">...</span>}
        </div>
      </div>

      {status === "solved" && (
        <div className="flex gap-3">
          <a href="/dashboard" className="text-blue-600 hover:underline">
            ← Back to puzzles
          </a>
          <a href="/practice" className="text-blue-600 hover:underline">
            Next puzzle →
          </a>
        </div>
      )}
      {status === "failed" && (
        <a href="/dashboard" className="text-blue-600 hover:underline">
          ← Try another puzzle
        </a>
      )}
    </div>
  );
}
