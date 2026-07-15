"use client";

import { Chessboard } from "react-chessboard";

type Props = {
  fen: string;
  maxWidth?: number;
  orientation?: "white" | "black";
};

/**
 * Static, non-interactive chessboard for previewing a position. Wraps the same
 * `react-chessboard` `Chessboard` used by the solver, but with dragging disabled
 * and no move handling — purely for visualization. Reuses the solver's square
 * colors so previews match the in-game board.
 */
export function BoardPreview({ fen, maxWidth = 220, orientation = "white" }: Props) {
  return (
    <div style={{ maxWidth, width: "100%" }}>
      <Chessboard
        options={{
          position: fen,
          allowDragging: false,
          boardOrientation: orientation,
          boardStyle: { borderRadius: "0" },
          lightSquareStyle: { backgroundColor: "#ece4d2" },
          darkSquareStyle: { backgroundColor: "#a8926b" },
          showNotation: false,
        }}
      />
    </div>
  );
}
