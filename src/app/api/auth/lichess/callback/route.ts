import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForToken, fetchAccount, persistLichessConnection } from "@/lib/lichess";
import { getStudentActor } from "@/lib/auth-guards";

/**
 * GET /api/auth/lichess/callback — OAuth callback.
 * Lichess redirects here with ?code=...&state=...
 * We validate state against the cookie, exchange the code, read /api/account,
 * persist the ratings, and discard the token.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${process.env.BETTER_AUTH_URL}/profile?lichess_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${process.env.BETTER_AUTH_URL}/profile?lichess_error=missing_params`);
  }

  // Validate state against the cookie.
  const cookieStore = await cookies();
  const pkceCookie = cookieStore.get("lichess_pkce");
  if (!pkceCookie) {
    return NextResponse.redirect(`${process.env.BETTER_AUTH_URL}/profile?lichess_error=no_pkce_cookie`);
  }

  let pkce: { verifier: string; state: string; studentId: string };
  try {
    pkce = JSON.parse(pkceCookie.value);
  } catch {
    return NextResponse.redirect(`${process.env.BETTER_AUTH_URL}/profile?lichess_error=bad_cookie`);
  }

  // Clear the cookie regardless (one-shot).
  cookieStore.delete("lichess_pkce");

  if (pkce.state !== state) {
    return NextResponse.redirect(`${process.env.BETTER_AUTH_URL}/profile?lichess_error=state_mismatch`);
  }

  // Verify the session student matches the one who started the flow.
  const student = await getStudentActor();
  if (!student || student.id !== pkce.studentId) {
    return NextResponse.redirect(`${process.env.BETTER_AUTH_URL}/profile?lichess_error=session_mismatch`);
  }

  try {
    // Exchange code for token.
    const redirectUri = `${process.env.BETTER_AUTH_URL}/api/auth/lichess/callback`;
    const accessToken = await exchangeCodeForToken({
      code,
      verifier: pkce.verifier,
      redirectUri,
      clientId: process.env.LICHESS_CLIENT_ID!,
    });

    // Fetch account + perfs.
    const account = await fetchAccount(accessToken);

    // Persist ratings (with init guard for inAppRating).
    await persistLichessConnection(student.id, account);

    return NextResponse.redirect(`${process.env.BETTER_AUTH_URL}/profile?lichess=connected`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.redirect(`${process.env.BETTER_AUTH_URL}/profile?lichess_error=${encodeURIComponent(msg)}`);
  }
}
