/**
 * Coach-facing name for a set's mode. The DB enum (MANUAL/FILTER) is an
 * implementation detail; tutors and students see "Curated"/"Adaptive" — the
 * same vocabulary the student dashboard already uses. One place so the two
 * apps never drift.
 */
export function modeLabel(mode: "MANUAL" | "FILTER"): string {
  return mode === "FILTER" ? "Adaptive" : "Curated";
}
