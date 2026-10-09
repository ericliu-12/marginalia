import { NextResponse, type NextRequest } from "next/server";
import { gate, SESSION_COOKIE, sessionCookie, shouldRenew, verifyToken } from "@/lib/session";

// Everything but /login, the build's static files, and the icons and manifest (fetched without the
// cookie when the app is added to the home screen) needs the session cookie. A page without one
// goes to /login and comes back after; a Server Function or API call is refused.
export function proxy(request: NextRequest) {
  const g = gate();
  if (g.kind === "open") return NextResponse.next();
  const issued = g.kind === "on" ? verifyToken(request.cookies.get(SESSION_COOKIE)?.value, g.secret) : null;
  if (issued === null) {
    const { pathname, search } = request.nextUrl;
    if (request.method !== "GET" || pathname.startsWith("/api/")) return new NextResponse(null, { status: 401 });
    const login = new URL("/login", request.url);
    if (pathname !== "/" || search) login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  const response = NextResponse.next();
  if (g.kind === "on" && shouldRenew(issued)) response.cookies.set(sessionCookie(g.secret));
  return response;
}

export const config = { matcher: ["/((?!login|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest|icons/).*)"] };
