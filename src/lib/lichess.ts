import { db } from "@/lib/db";

/**
 * Lichess PKCE OAuth client.
 *
 * Lichess uses OAuth2 with PKCE (no client secret, no refresh token — tokens
 * are long-lived but we discard ours after reading ratings). See:
 * https://lichess.org/api#tag/OAuth
 *
 * Flow:
 * 1. Generate verifier + S256 challenge, store verifier in a cookie.
 * 2. Redirect to lichess.org/oauth with code_challenge.
 * 3. On callback, exchange code+verifier for an access_token.
 * 4. Call GET /api/account once → read perfs (puzzle/rapid/blitz ratings).
 * 5. Discard the token. Persist ratings to LichessConnection + Student.
 */

const LICHESS_BASE = "https://lichess.org";

export type LichessPerfs = {
  puzzle?: { rating: number; games: number; rd: number; prog: number; prov?: boolean };
  rapid?: { rating: number; games: number; rd: number; prog: number; prov?: boolean };
  blitz?: { rating: number; games: number; rd: number; prog: number; prov?: boolean };
};

export type LichessAccount = {
  id: string;
  username: string;
  perfs: LichessPerfs;
};

/** Generate a PKCE code verifier (43-128 chars, base64url-random) and its S256 challenge. */
export async function generatePkcePair(): Promise<{ verifier: string; challenge: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = base64url(bytes);

  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  const challenge = base64url(digest);

  return { verifier, challenge };
}

function base64url(input: Uint8Array | ArrayBuffer): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Build the Lichess OAuth authorization URL. */
export function buildAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const url = new URL(`${LICHESS_BASE}/oauth`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("scope", ""); // empty scope — perfs are readable without it
  url.searchParams.set("state", params.state);
  return url.toString();
}

/** Exchange the authorization code for an access token. Returns the token. */
export async function exchangeCodeForToken(params: {
  code: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
}): Promise<string> {
  const res = await fetch(`${LICHESS_BASE}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: params.code,
      code_verifier: params.verifier,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Lichess token exchange failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  return data.access_token as string;
}

/** Call GET /api/account with the access token to read the user's profile + perfs. */
export async function fetchAccount(accessToken: string): Promise<LichessAccount> {
  const res = await fetch(`${LICHESS_BASE}/api/account`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Lichess /api/account failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Persist the Lichess connection + ratings to the student. Applies the init
 * guard: inAppRating is only set from the Lichess prior if the student has no
 * RatingEvents yet (hasn't practiced in-app).
 */
export async function persistLichessConnection(
  studentId: string,
  account: LichessAccount
): Promise<void> {
  const puzzleRating = account.perfs.puzzle?.rating ?? null;
  const gameRating = account.perfs.rapid?.rating ?? account.perfs.blitz?.rating ?? null;

  await db.$transaction(async (tx) => {
    // Upsert the LichessConnection.
    await tx.lichessConnection.upsert({
      where: { studentId },
      create: {
        studentId,
        lichessId: account.id,
        lichessUsername: account.username,
        lastSyncedAt: new Date(),
      },
      update: {
        lichessId: account.id,
        lichessUsername: account.username,
        lastSyncedAt: new Date(),
      },
    });

    // Init guard: only set inAppRating if no RatingEvents exist.
    const ratedEventCount = await tx.ratingEvent.count({ where: { studentId } });
    const update: { lichessPuzzleRating?: number | null; lichessGameRating?: number | null; inAppRating?: number } = {
      lichessPuzzleRating: puzzleRating,
      lichessGameRating: gameRating,
    };

    if (ratedEventCount === 0) {
      // Initialize inAppRating from the prior.
      if (puzzleRating) update.inAppRating = puzzleRating;
      else if (gameRating) update.inAppRating = gameRating;
      // else: leave at 1500 default
    }

    await tx.student.update({ where: { id: studentId }, data: update });
  });
}
