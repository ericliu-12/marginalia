import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
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

// Everything else needs a Reader's session cookie. A page without one goes to sign-in and comes back
// after; a Server Function or API call is refused. Only the cookie's presence is checked here: each page
// and Server Function checks the session itself (requireReader).
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isRailwayHost(request.headers.get("host"))) return NextResponse.redirect(new URL(pathname + search, siteUrl()), 308);
  if (isPublic(pathname) || getSessionCookie(request)) return NextResponse.next();
  if (request.method !== "GET" || pathname.startsWith("/api/")) return new NextResponse(null, { status: 401 });
  const signIn = new URL("/sign-in", siteUrl());
  if (pathname !== "/" || search) signIn.searchParams.set("next", pathname + search);
  return NextResponse.redirect(signIn);
}
