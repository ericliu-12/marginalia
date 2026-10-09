import { NextResponse, type NextRequest } from "next/server";
import { gate, SESSION_COOKIE, sessionCookie, shouldRenew, verifyToken } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";

// Railway's own domain (*.up.railway.app). Sign-in belongs to the site's domain alone, so every request
// there is sent on, path and all. The host is read from the Host header, which is the address the
// visitor used; the request's URL is the server's own.
const isRailwayHost = (host: string | null) => /\.up\.railway\.app$/.test(host?.split(":")[0] ?? "");

// /login, the build's static files, and the icons and manifest (fetched without the cookie when the app
// is added to the home screen) need no session.
const isPublic = (pathname: string) =>
  /^\/(?:login|_next\/static|_next\/image|favicon\.ico|icon\.png|apple-icon\.png|manifest\.webmanifest|icons\/)/.test(pathname);

// Everything else needs the session cookie. A page without one goes to /login and comes back after;
// a Server Function or API call is refused.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isRailwayHost(request.headers.get("host"))) return NextResponse.redirect(new URL(pathname + search, siteUrl()), 308);
  if (isPublic(pathname)) return NextResponse.next();
  const g = gate();
  if (g.kind === "open") return NextResponse.next();
  const issued = g.kind === "on" ? verifyToken(request.cookies.get(SESSION_COOKIE)?.value, g.secret) : null;
  if (issued === null) {
    if (request.method !== "GET" || pathname.startsWith("/api/")) return new NextResponse(null, { status: 401 });
    const login = new URL("/login", siteUrl());
    if (pathname !== "/" || search) login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  const response = NextResponse.next();
  if (g.kind === "on" && shouldRenew(issued)) response.cookies.set(sessionCookie(g.secret));
  return response;
}
