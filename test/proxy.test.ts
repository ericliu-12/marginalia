import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../src/proxy";

// As Railway delivers a request: the server's own address in the URL (localhost:8080), the address the
// visitor used only in the Host header. Nothing absolute may be built from the URL.
const fromRailway = (path: string, host: string) =>
  new NextRequest(`http://localhost:8080${path}`, { headers: { host, "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.5" } });

describe("proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends every request on the Railway host to the same path on BETTER_AUTH_URL with a 308", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://inkmarginalia.com");
    for (const path of ["/", "/graph?book=1", "/login", "/api/auth/get-session", "/icons/192.png"]) {
      const response = proxy(fromRailway(path, "web-production-fd25da.up.railway.app"));
      expect(response.status, path).toBe(308);
      expect(response.headers.get("location"), path).toBe(`https://inkmarginalia.com${path}`);
    }
  });

  it("lets a request on the site's own host through", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://inkmarginalia.com");
    const response = proxy(fromRailway("/graph", "inkmarginalia.com"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("lets /privacy and /terms through without a session, for Google's consent screen, and nothing that only starts like them", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://inkmarginalia.com");
    vi.stubEnv("APP_PASSWORD", "password");
    vi.stubEnv("SESSION_SECRET", "a-session-secret-at-least-32-characters");
    for (const path of ["/privacy", "/terms"]) expect(proxy(fromRailway(path, "inkmarginalia.com")).headers.get("x-middleware-next"), path).toBe("1");
    for (const path of ["/privacy-x", "/termsheet"]) expect(proxy(fromRailway(path, "inkmarginalia.com")).headers.get("location"), path).toMatch(/\/login\?next=/);
  });
});
