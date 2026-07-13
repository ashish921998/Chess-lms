/**
 * The "how many things are in this version/assignment" rule, centralized so the
 * MANUAL (`PuzzleSetVersionItem` count) vs FILTER (`targetCount`) distinction
 * lives in one place. Used by the dashboard cards, the student solver header,
 * and the tutor roster chips.
 */
export function versionTotal(version: {
  mode: "MANUAL" | "FILTER";
  targetCount: number | null;
  _count: { items: number };
}): number {
  return version.mode === "FILTER"
    ? version.targetCount ?? 0
    : version._count.items;
}
