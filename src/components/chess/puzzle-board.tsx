"use client";

import { useState, useCallback } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import Link from "next/link";
import { HINT_COST, SKIP_COST } from "@/lib/economy";

type BoardStatus = "playing" | "incorrect" | "failed" | "solved" | "skipped";

type Props = {
  attemptId: string;
  startFen: string;
  solutionLength: number;
  initialRevision: number;
  coinBalance: number;
  usedHint: boolean;
  hintMove: string | null;
};

/**
 * Interactive puzzle board. The client NEVER knows the solution — it posts each
 * move to the server, which validates and responds with continue/incorrect/
 * illegal/solved. The client tracks the board position (via chess.js) and the
 * revision cursor the server expects.
 *
 * Spend buttons (HINT · 15 / SKIP · 30) appear during any PENDING attempt and
 * open a confirm popover showing the cost + live balance. The hint reveals the
 * best move as a highlight on the board but does NOT auto-play it.
 */
export function PuzzleBoard({
  attemptId,
  startFen,
  initialRevision,
  coinBalance: initialCoins,
  usedHint: initialUsedHint,
  hintMove: initialHintMove,
}: Props) {
  const [game, setGame] = useState(() => new Chess(startFen));
  const [revision, setRevision] = useState(initialRevision);
  const [status, setStatus] = useState<BoardStatus>("playing");
  const [message, setMessage] = useState("Find the best move");
  const [waiting, setWaiting] = useState(false);

  // Spend state.
  const [coins, setCoins] = useState(initialCoins);
  const [usedHint, setUsedHint] = useState(initialUsedHint);
  const [hintMove, setHintMove] = useState<string | null>(initialHintMove);
  const [confirm, setConfirm] = useState<null | "hint" | "skip">(null);
  const [spendError, setSpendError] = useState<string | null>(null);

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
      setSpendError(null);
      fetch(`/api/attempts/${attemptId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ move: uci, expectedRevision: revision }),
      })
        .then((r) => r.json())
        .then((body) => {
          if (body.status === "illegal") {
            setMessage("Illegal move");
          } else if (body.status === "incorrect") {
            setMessage(`Not the best move (${body.failCount}/${2} tries)`);
            setRevision(body.expectedRevision ?? revision + 1);
            setGame(new Chess(testGame.fen()));
          } else if (body.status === "failed") {
            setGame(new Chess(testGame.fen()));
            setStatus("failed");
            setMessage("Out of tries — the puzzle is complete.");
          } else if (body.status === "solved") {
            setGame(new Chess(testGame.fen()));
            setStatus("solved");
            setMessage(body.coinsAwarded > 0 ? `Solved! +${body.coinsAwarded} coins` : "Solved again — nice work! (practice only)");
          } else if (body.status === "continue") {
            testGame.move(body.opponentMove);
            setGame(new Chess(testGame.fen()));
            setRevision(body.expectedRevision);
            setMessage("Good move — keep going");
          } else if (body.error === "revision_mismatch") {
            setMessage("Position changed — refreshing...");
            setRevision(body.expectedRevision);
            setTimeout(() => window.location.reload(), 800);
          } else if (body.error === "attempt_finalized") {
            setStatus("failed");
            setMessage("This puzzle was already completed.");
          }
        })
        .catch(() => setMessage("Connection error — try again"))
        .finally(() => setWaiting(false));

      return true;
    },
    [game, status, waiting, revision, attemptId]
  );

  // Hint reveal: highlight the revealed move's source-destination squares.
  const hintSquares = (() => {
    if (!hintMove) return {};
    const from = hintMove.slice(0, 2);
    const to = hintMove.slice(2, 4);
    return {
      [from]: { boxShadow: "inset 0 0 0 4px rgba(164,86,47,0.55)" },
      [to]: { boxShadow: "inset 0 0 0 4px rgba(164,86,47,0.55)" },
    };
  })();

  const pending = status === "playing";
  const hintDisabled = coins < HINT_COST;
  const skipDisabled = coins < SKIP_COST;

  async function confirmSpend(kind: "hint" | "skip") {
    setSpendError(null);
    const cost = kind === "hint" ? HINT_COST : SKIP_COST;
    const res = await fetch(`/api/attempts/${attemptId}/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 402) {
      setSpendError("Not enough coins");
      setConfirm(null);
      return;
    }
    if (res.status === 409) {
      setSpendError("This puzzle is no longer active.");
      setConfirm(null);
      setStatus("failed");
      return;
    }
    if (!res.ok) {
      setSpendError(body.error || "Something went wrong");
      setConfirm(null);
      return;
    }
    setCoins((c) => c - cost);
    if (kind === "hint") {
      setUsedHint(true);
      setHintMove(body.hintMove);
      setMessage("Hint revealed — play the highlighted move");
    } else {
      setStatus("skipped");
      setMessage("Skipped");
    }
    setConfirm(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3">
        <div style={{ maxWidth: 420, width: "100%" }}>
          <Chessboard
            options={{
              position: game.fen(),
              onPieceDrop,
              allowDragging: status === "playing" && !waiting,
              boardStyle: { borderRadius: "0" },
              lightSquareStyle: { backgroundColor: "#ece4d2" },
              darkSquareStyle: { backgroundColor: "#a8926b" },
              squareStyles: hintSquares,
            }}
          />
        </div>
        <div className="flex items-center gap-3">
          <p
            className={`text-[13px] ${
              status === "solved"
                ? "text-success"
                : status === "failed" || status === "skipped"
                ? "text-error"
                : "text-ink"
            }`}
          >
            {message}
          </p>
          {waiting && <span className="text-[12px] text-muted2">...</span>}
        </div>
      </div>

      {/* Spend buttons — visible during any PENDING attempt. */}
      {pending && (
        <div className="relative flex flex-wrap items-center justify-center gap-3">
          {!usedHint && (
            <SpendButton
              label="Hint"
              cost={HINT_COST}
              balance={coins}
              disabled={hintDisabled}
              open={confirm === "hint"}
              onOpen={() => setConfirm("hint")}
              onClose={() => setConfirm(null)}
              onConfirm={() => confirmSpend("hint")}
            />
          )}
          <SpendButton
            label="Skip"
            cost={SKIP_COST}
            balance={coins}
            disabled={skipDisabled}
            open={confirm === "skip"}
            onOpen={() => setConfirm("skip")}
            onClose={() => setConfirm(null)}
            onConfirm={() => confirmSpend("skip")}
          />
          {spendError && <span className="text-[12px] text-error">{spendError}</span>}
        </div>
      )}

      {(status === "solved" || status === "skipped") && (
        <div className="flex gap-3">
          <Link
            href="/dashboard"
            className="text-[12px] uppercase tracking-[0.06em] text-rust hover:underline underline-offset-2"
          >
            ← Back to puzzles
          </Link>
          <Link
            href="/practice"
            className="text-[12px] uppercase tracking-[0.06em] text-rust hover:underline underline-offset-2"
          >
            Next puzzle →
          </Link>
        </div>
      )}
      {status === "failed" && (
        <Link
          href="/dashboard"
          className="text-[12px] uppercase tracking-[0.06em] text-rust hover:underline underline-offset-2"
        >
          ← Try another puzzle
        </Link>
      )}
    </div>
  );
}

/**
 * A spend button with a confirm popover. Shows the cost; disabled (muted, with
 * a tooltip) when the balance can't cover it. Clicking opens a small popover
 * restating the cost + balance with Confirm / Cancel.
 */
function SpendButton({
  label,
  cost,
  balance,
  disabled,
  open,
  onOpen,
  onClose,
  onConfirm,
}: {
  label: string;
  cost: number;
  balance: number;
  disabled: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        title={disabled ? `Need ${cost} coins` : undefined}
        className={`min-h-[40px] px-4 text-[11px] uppercase tracking-[0.07em] border ${
          disabled
            ? "border-line text-muted2 cursor-not-allowed"
            : "border-ink text-ink hover:bg-ink hover:text-paper"
        } transition-colors`}
      >
        {label} · {cost}
      </button>
      {open && !disabled && (
        <div
          className="absolute z-10 mt-2 left-1/2 -translate-x-1/2 border border-ink bg-paper px-4 py-3 text-[12px] w-64"
          role="dialog"
          aria-label={`${label} confirmation`}
        >
          <p className="text-ink">
            {label === "Hint"
              ? `Reveal the best move for ${cost} coins?`
              : `Skip this puzzle for ${cost} coins?`}
          </p>
          <p className="mt-1 text-muted">Balance: {balance}</p>
          <div className="mt-3 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] uppercase tracking-[0.06em] text-muted hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="text-[11px] uppercase tracking-[0.06em] text-rust hover:underline underline-offset-2"
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
