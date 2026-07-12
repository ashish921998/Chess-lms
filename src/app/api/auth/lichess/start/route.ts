import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generatePkcePair, buildAuthUrl } from "@/lib/lichess";
import { getStudentActor } from "@/lib/auth-guards";

/**
 * GET /api/auth/lichess/start — begins the PKCE OAuth flow.
 * Generates a verifier+challenge, stores the verifier in a short-lived
 * HttpOnly cookie, and redirects to Lichess's authorization page.
 */
export async function GET() {
  const student = await getStudentActor();
  if (!student) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { verifier, challenge } = await generatePkcePair();

  // State = random token to prevent CSRF. We bundle the studentId so the
  // callback knows which student to link (the session also proves this).
  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const state = Array.from(stateBytes, (b) => b.toString(16).padStart(2, "0")).join("");

  // Store verifier + state in a short-lived HttpOnly cookie.
  const cookieStore = await cookies();
  cookieStore.set("lichess_pkce", JSON.stringify({ verifier, state, studentId: student.id }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 minutes — enough for the OAuth round-trip
  });

  const clientId = process.env.LICHESS_CLIENT_ID!;
  const redirectUri = `${process.env.BETTER_AUTH_URL}/api/auth/lichess/callback`;

  const authUrl = buildAuthUrl({ clientId, redirectUri, challenge, state });
  return NextResponse.redirect(authUrl);
}
