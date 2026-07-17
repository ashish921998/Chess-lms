/**
 * Lightweight developer gate for the platform-guide feedback board.
 *
 * "The developer" (you) is identified by email allowlist via the
 * `DEVELOPER_EMAILS` env var (comma-separated). When signed in as a tutor
 * whose email is allowlisted, the feedback UI exposes status controls and a
 * dev-note field — i.e. the ability to triage and resolve tutor requests.
 *
 * Regular tutors can read the whole board and post/edit/delete only their own
 * feedback. No new auth role is introduced; this is presentation/permission
 * sugar layered on top of the existing TUTOR role.
 */
export function isDeveloperEmail(email: string | null | undefined): boolean {
  const list = (process.env.DEVELOPER_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return false;
  return list.includes((email ?? "").trim().toLowerCase());
}
