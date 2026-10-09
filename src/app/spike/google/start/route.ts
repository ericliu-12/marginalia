import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { cookieOptions, redirectUri, STATE_COOKIE } from "../oauth";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(new URL("/spike/google?problem=unconfigured", request.url));
  const state = randomBytes(16).toString("base64url");
  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(request.nextUrl.origin),
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  }).toString();
  const response = NextResponse.redirect(google);
  // The state rides in this browser's cookies: if the callback lands in another cookie jar (Safari
  // rather than the home-screen app), it arrives without it, and the spike page says so.
  response.cookies.set(STATE_COOKIE, state, cookieOptions(10 * 60));
  return response;
}
