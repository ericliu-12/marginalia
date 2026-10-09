import { describe, expect, it } from "vitest";
import { gate, issueToken, passwordMatches, safeNext, shouldRenew, verifyToken } from "../src/lib/session";
import { clientAddress, createSignInLimit } from "../src/lib/sign-in-limit";

const SECRET = "s".repeat(32);
const DAY = 24 * 60 * 60 * 1000;

describe("gate", () => {
  it("is open only outside production with nothing set, and closed in production without both values", () => {
    expect(gate({ NODE_ENV: "development" })).toEqual({ kind: "open" });
    expect(gate({ NODE_ENV: "production" })).toEqual({ kind: "closed" });
    expect(gate({ NODE_ENV: "development", APP_PASSWORD: "pw" })).toEqual({ kind: "closed" });
    expect(gate({ NODE_ENV: "production", APP_PASSWORD: "pw", SESSION_SECRET: "short" })).toEqual({ kind: "closed" });
    expect(gate({ NODE_ENV: "production", APP_PASSWORD: "pw", SESSION_SECRET: SECRET })).toEqual({ kind: "on", password: "pw", secret: SECRET });
  });
});

describe("session token", () => {
  const now = Date.UTC(2026, 9, 1);

  it("verifies until 90 days old, and is renewed once a day old", () => {
    const token = issueToken(SECRET, now);
    expect(verifyToken(token, SECRET, now)).toBe(now / 1000);
    expect(verifyToken(token, SECRET, now + 89 * DAY)).not.toBeNull();
    expect(verifyToken(token, SECRET, now + 90 * DAY)).toBeNull();
    expect(shouldRenew(now / 1000, now + DAY / 2)).toBe(false);
    expect(shouldRenew(now / 1000, now + 2 * DAY)).toBe(true);
  });

  it("refuses a token signed with another secret, altered, or missing", () => {
    const token = issueToken(SECRET, now);
    expect(verifyToken(token, "t".repeat(32), now)).toBeNull();
    expect(verifyToken(`${now / 1000 + 1}.${token.split(".")[1]}`, SECRET, now)).toBeNull();
    expect(verifyToken(undefined, SECRET, now)).toBeNull();
    expect(verifyToken("garbage", SECRET, now)).toBeNull();
  });

  it("matches the password exactly", () => {
    expect(passwordMatches("correct horse", "correct horse")).toBe(true);
    expect(passwordMatches("correct hors", "correct horse")).toBe(false);
  });

  it("returns only to a path on this site", () => {
    expect(safeNext("/graph?x=1")).toBe("/graph?x=1");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

describe("sign-in limit", () => {
  it("stops an address after five wrong passwords for fifteen minutes, and a right one clears it", () => {
    let t = 0;
    const limit = createSignInLimit(() => t);
    for (let i = 0; i < 4; i++) limit.failed("a");
    expect(limit.retryAfterMs("a")).toBe(0);
    limit.failed("a");
    expect(limit.retryAfterMs("a")).toBe(15 * 60 * 1000);
    expect(limit.retryAfterMs("b")).toBe(0);
    t = 15 * 60 * 1000;
    expect(limit.retryAfterMs("a")).toBe(0);
    for (let i = 0; i < 4; i++) limit.failed("a");
    limit.succeeded("a");
    limit.failed("a");
    expect(limit.retryAfterMs("a")).toBe(0);
  });

  it("stops everyone after fifty wrong passwords across addresses", () => {
    const limit = createSignInLimit(() => 0);
    for (let i = 0; i < 50; i++) limit.failed(`addr-${i}`);
    expect(limit.retryAfterMs("fresh")).toBeGreaterThan(0);
  });

  it("takes the address the edge appended, not one the client wrote", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientAddress(new Headers({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    expect(clientAddress(new Headers())).toBe("unknown");
  });
});
