import { describe, it, expect } from "vitest";
import { humanizeTheme, puzzleTitle } from "@/lib/puzzles/labels";

/**
 * Unit checks for student-facing puzzle naming. Pure functions, no DB.
 */
describe("humanizeTheme", () => {
  it("splits camelCase and capitalizes", () => {
    expect(humanizeTheme("backRank")).toBe("Back rank");
    expect(humanizeTheme("mate")).toBe("Mate");
    expect(humanizeTheme("discoveredAttack")).toBe("Discovered attack");
  });

  it("splits letter→digit boundaries (Lichess mateInN tags)", () => {
    expect(humanizeTheme("mateIn2")).toBe("Mate in 2");
    expect(humanizeTheme("mateIn1")).toBe("Mate in 1");
  });
});

describe("puzzleTitle", () => {
  it("prefers the tactical theme over length qualifiers", () => {
    expect(puzzleTitle(["short", "backRank", "mate"])).toBe("Back rank");
    expect(puzzleTitle(["mate", "short", "opening"])).toBe("Mate");
  });

  it("falls back when only qualifiers or nothing is present", () => {
    expect(puzzleTitle(["short"])).toBe("Short"); // no non-qualifier → first
    expect(puzzleTitle([])).toBe("Tactical puzzle");
  });
});
