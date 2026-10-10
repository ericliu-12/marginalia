import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { appAuth } from "@/lib/auth";
import { SIGNED_OUT, signInPath } from "@/lib/signed-out";
import { siteUrl } from "@/lib/site-url";

// Railway's own domain (*.up.railway.app). Sign-in belongs to the site's domain alone, so every request
// there is sent on, path and all. The host is read from the Host header, which is the address the
// visitor used; the request's URL is the server's own.
const isRailwayHost = (host: string | null) => /\.up\.railway\.app$/.test(host?.split(":")[0] ?? "");

// Sign-in and Better Auth's endpoints, exactly /privacy and /terms (read by Google's consent screen), the
// build's static files, and the icons and manifest (fetched without the cookie when the app is added to
// the home screen) need no session.
const isPublic = (pathname: string) =>
  /^\/(?:sign-in|privacy|terms)$/.test(pathname) ||
  /^\/(?:api\/auth\/|_next\/static|_next\/image|favicon\.ico|icon\.png|apple-icon\.png|manifest\.webmanifest|icons\/)/.test(pathname);

// A call without a live session, whether its cookie is missing, forged or expired, gets this one answer,
// which the client's Server Functions turn into a trip to sign-in (see client-actions.ts).
const signedOut = () => new NextResponse(SIGNED_OUT, { status: 401, headers: { "content-type": "text/plain" } });

// Everything else needs a Reader's session. A page without its cookie goes to sign-in and comes back
// after; a page with a stale one checks the session itself (requireReader). A Server Function or API call
// is checked here in full, so a stale cookie is refused just as a missing one is.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isRailwayHost(request.headers.get("host"))) return NextResponse.redirect(new URL(pathname + search, siteUrl()), 308);
  if (isPublic(pathname)) return NextResponse.next();
  const isCall = request.method !== "GET" || pathname.startsWith("/api/");
  if (!getSessionCookie(request)) return isCall ? signedOut() : NextResponse.redirect(new URL(signInPath(pathname + search), siteUrl()));
  if (isCall && !(await appAuth().api.getSession({ headers: request.headers }))) return signedOut();
  return NextResponse.next();
}
