import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../src/proxy";

// As Railway delivers a request: the server's own address in the URL (localhost:8080), the address the
// visitor used only in the Host header. Nothing absolute may be built from the URL.
const fromRailway = (path: string, host: string, init: { method?: string; cookie?: string } = {}) =>
  new NextRequest(`http://localhost:8080${path}`, {
    method: init.method,
    headers: { host, "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.5", ...(init.cookie ? { cookie: init.cookie } : {}) },
  });
const onSite = (path: string, init?: { method?: string; cookie?: string }) => proxy(fromRailway(path, "inkmarginalia.com", init));
// Better Auth's session cookie, as production names it.
const SESSION = "__Secure-better-auth.session_token=token.signature";

describe("proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends every request on the Railway host to the same path on BETTER_AUTH_URL with a 308", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://inkmarginalia.com");
    for (const path of ["/", "/graph?book=1", "/sign-in", "/api/auth/get-session", "/icons/192.png"]) {
      const response = proxy(fromRailway(path, "web-production-fd25da.up.railway.app"));
      expect(response.status, path).toBe(308);
      expect(response.headers.get("location"), path).toBe(`https://inkmarginalia.com${path}`);
    }
  });

  it("lets a request with a Reader's session through", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://inkmarginalia.com");
    const response = onSite("/graph", { cookie: SESSION });
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("sends a signed-out page to sign-in and back after, and refuses a signed-out Server Function or API call", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://inkmarginalia.com");
    expect(onSite("/").headers.get("location")).toBe("https://inkmarginalia.com/sign-in");
    expect(onSite("/graph?book=1").headers.get("location")).toBe("https://inkmarginalia.com/sign-in?next=%2Fgraph%3Fbook%3D1");
    expect(onSite("/", { method: "POST" }).status).toBe(401);
    expect(onSite("/api/search?q=stoner").status).toBe(401);
  });

  it("lets sign-in, Better Auth's endpoints, the home-screen icons and manifest, and /privacy and /terms through without a session", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://inkmarginalia.com");
    for (const path of ["/sign-in", "/sign-in?next=%2Fgraph", "/privacy", "/terms", "/manifest.webmanifest", "/apple-icon.png", "/icons/192.png"])
      expect(onSite(path).headers.get("x-middleware-next"), path).toBe("1");
    expect(onSite("/api/auth/email-otp/send-verification-otp", { method: "POST" }).headers.get("x-middleware-next")).toBe("1");
  });

  it("lets nothing through that only starts like a public path", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://inkmarginalia.com");
    for (const path of ["/privacy-x", "/termsheet", "/sign-inx", "/login"]) expect(onSite(path).headers.get("location"), path).toMatch(/\/sign-in\?next=/);
    expect(onSite("/api/authx").status).toBe(401);
  });
});
