import { NextResponse, type NextRequest } from "next/server";
import { cookieOptions, redirectUri, SIGNED_IN_COOKIE, STATE_COOKIE } from "../oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const back = (query: string) => {
    const response = NextResponse.redirect(new URL(`/spike/google?${query}`, request.url));
    response.cookies.set(STATE_COOKIE, "", cookieOptions(0));
    return response;
  };
  if (params.get("error")) return back(`problem=google&detail=${encodeURIComponent(params.get("error")!)}`);
  const state = request.cookies.get(STATE_COOKIE)?.value;
  if (!state) return back("problem=no-state");
  if (state !== params.get("state")) return back("problem=state-mismatch");

  const token = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      code: params.get("code") ?? "",
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri(request.nextUrl.origin),
      grant_type: "authorization_code",
    }),
  });
  if (!token.ok) {
    console.error("Spike: Google token exchange failed", token.status, await token.text());
    return back("problem=token");
  }
  // Straight from Google over TLS, so the ID token's payload is read without checking its signature.
  const { id_token } = (await token.json()) as { id_token: string };
  const { email } = JSON.parse(Buffer.from(id_token.split(".")[1], "base64url").toString()) as { email: string };
  const response = back("signed-in=1");
  response.cookies.set(SIGNED_IN_COOKIE, email, cookieOptions(30 * 24 * 60 * 60));
  return response;
}
