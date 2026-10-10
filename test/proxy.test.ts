import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../src/proxy";

// Better Auth knows only the session in VALID; any other cookie is forged or expired.
const sessionChecks = vi.hoisted(() => ({ count: 0 }));
vi.mock("../src/lib/auth", () => ({
  appAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        sessionChecks.count++;
        return headers.get("cookie")?.includes("valid-token") ? { user: { id: "reader" } } : null;
      },
    },
  }),
}));

// As Railway delivers a request: the server's own address in the URL (localhost:8080), the address the
// visitor used only in the Host header. Nothing absolute may be built from the URL.
const fromRailway = (path: string, host: string, init: { method?: string; cookie?: string } = {}) =>
  new NextRequest(`http://localhost:8080${path}`, {
    method: init.method,
    headers: { host, "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.5", ...(init.cookie ? { cookie: init.cookie } : {}) },
  });
const onSite = (path: string, init?: { method?: string; cookie?: string }) => proxy(fromRailway(path, "inkmarginalia.com", init));
// Better Auth's session cookie, as production names it: one it knows, and one that has expired.
const SESSION = "__Secure-better-auth.session_token=valid-token.signature";
const EXPIRED = "__Secure-better-auth.session_token=expired-token.signature";
const SERVER_FUNCTION = { method: "POST", headers: { "next-action": "abc123" } };

// The one signed-out answer to a call: a 401 whose plain-text body Next's client hands to the caller as the
// error's message (see untilSignedOut).
async function expectSignedOut(pending: Promise<Response> | Response) {
  const response = await pending;
  expect(response.status).toBe(401);
  expect(response.headers.get("content-type")).toBe("text/plain");
  expect(await response.text()).toBe("Signed out.");
}

describe("proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends every request on the Railway host to the same path on BETTER_AUTH_URL with a 308", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://inkmarginalia.com");
    for (const path of ["/", "/graph?book=1", "/sign-in", "/api/auth/get-session", "/icons/192.png"]) {
      const response = await proxy(fromRailway(path, "web-production-fd25da.up.railway.app"));
      expect(response.status, path).toBe(308);
      expect(response.headers.get("location"), path).toBe(`https://inkmarginalia.com${path}`);
    }
  });

  it("lets a request with a Reader's session through", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://inkmarginalia.com");
    const response = await onSite("/graph", { cookie: SESSION });
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("sends a signed-out page to sign-in and back after, and refuses a signed-out Server Function or API call", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://inkmarginalia.com");
    expect((await onSite("/")).headers.get("location")).toBe("https://inkmarginalia.com/sign-in");
    expect((await onSite("/graph?book=1")).headers.get("location")).toBe("https://inkmarginalia.com/sign-in?next=%2Fgraph%3Fbook%3D1");
    await expectSignedOut(onSite("/", { method: "POST" }));
    await expectSignedOut(onSite("/api/search?q=stoner"));
  });

  it("refuses a Server Function or API call whose session has expired with the same answer as one with none", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://inkmarginalia.com");
    await expectSignedOut(proxy(new NextRequest("https://inkmarginalia.com/graph", { ...SERVER_FUNCTION, headers: { ...SERVER_FUNCTION.headers, cookie: EXPIRED } })));
    await expectSignedOut(onSite("/api/search?q=stoner", { cookie: EXPIRED }));
    const live = await proxy(new NextRequest("https://inkmarginalia.com/graph", { ...SERVER_FUNCTION, headers: { ...SERVER_FUNCTION.headers, cookie: SESSION } }));
    expect(live.headers.get("x-middleware-next")).toBe("1");
  });

  it("leaves an expired session on a page to the page, without asking Better Auth", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://inkmarginalia.com");
    const before = sessionChecks.count;
    expect((await onSite("/graph", { cookie: EXPIRED })).headers.get("x-middleware-next")).toBe("1");
    expect(sessionChecks.count).toBe(before);
  });

  it("lets sign-in, Better Auth's endpoints, the home-screen icons and manifest, and /privacy and /terms through without a session", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://inkmarginalia.com");
    for (const path of ["/sign-in", "/sign-in?next=%2Fgraph", "/privacy", "/terms", "/manifest.webmanifest", "/apple-icon.png", "/icons/192.png"])
      expect((await onSite(path)).headers.get("x-middleware-next"), path).toBe("1");
    expect((await onSite("/api/auth/email-otp/send-verification-otp", { method: "POST" })).headers.get("x-middleware-next")).toBe("1");
  });

  it("lets nothing through that only starts like a public path", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://inkmarginalia.com");
    for (const path of ["/privacy-x", "/termsheet", "/sign-inx", "/login"]) expect((await onSite(path)).headers.get("location"), path).toMatch(/\/sign-in\?next=/);
    await expectSignedOut(onSite("/api/authx"));
  });
});
