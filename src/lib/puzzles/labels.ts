/**
 * Student-facing puzzle naming. Puzzle IDs are Lichess hashes — meaningless to a
 * learner — so we surface the puzzle's theme instead. One place so the dashboard
 * and solver header always agree on what a puzzle is "called".
 */

// Length/phase qualifiers Lichess tags alongside the real tactical theme. Skip
// them when picking a title so "Back rank" wins over "Short".
const QUALIFIER_THEMES = new Set(["short", "long", "veryLong", "oneMove"]);

/** "backRank" → "Back rank". */
export function humanizeTheme(theme: string): string {
  const spaced = theme.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A short human title for a puzzle, derived from its themes. */
export function puzzleTitle(themes: string[]): string {
  const primary = themes.find((t) => !QUALIFIER_THEMES.has(t)) ?? themes[0];
  return primary ? humanizeTheme(primary) : "Tactical puzzle";
}
