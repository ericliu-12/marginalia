import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "../src/db/schema";
import { invite } from "../src/domain/allowlist";
import { createAuth } from "../src/lib/auth";
import { fakeMailer } from "./fakes";
import { useTestDb } from "./harness";

const BASE_URL = "https://marginalia.test";
const MINUTE = 60 * 1000;
const GOOGLE = { clientId: "client-id", clientSecret: "client-secret" };
const PASSING = "turnstile-pass";

// Abuse protection on sign-in (#65): asked for as the browser asks, through Better Auth's handler, with
// Cloudflare's siteverify faked to pass PASSING and nothing else.
describe("Asking for a sign-in code", () => {
  const ctx = useTestDb();
  let mailer: ReturnType<typeof fakeMailer>;
  const auth = (codeReplyMs = 0) =>
    createAuth(ctx.db, { mailer, signupMode: "allowlist", baseURL: BASE_URL, secret: "s".repeat(32), google: GOOGLE, turnstileSecretKey: "secret", codeReplyMs });
  const requestCode = (email: string, { ip = "203.0.113.1", token = PASSING as string | null, via = auth() } = {}) =>
    via.handler(
      new Request(`${BASE_URL}/api/auth/email-otp/send-verification-otp`, {
        method: "POST",
        headers: { origin: BASE_URL, "content-type": "application/json", "x-forwarded-for": ip, ...(token && { "x-captcha-response": token }) },
        body: JSON.stringify({ email, type: "sign-in" }),
      }),
    );
  const reply = async (res: Response) => ({ status: res.status, body: await res.json() });

  beforeEach(async () => {
    mailer = fakeMailer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => Response.json({ success: JSON.parse(String(init.body)).response === PASSING })),
    );
    await invite(ctx.db, "friend@example.com", BASE_URL);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("takes as long for an email that may not sign in as for an invited one", async () => {
    const timed = async (email: string, ip: string) => {
      const started = performance.now();
      const res = await requestCode(email, { ip, via: auth(300) });
      return { ms: performance.now() - started, reply: await reply(res) };
    };
    const invited = await timed("friend@example.com", "203.0.113.1");
    const stranger = await timed("stranger@example.com", "203.0.113.2");

    expect(stranger.reply).toEqual(invited.reply);
    expect(mailer.sent.map((m) => m.to)).toEqual(["friend@example.com"]);
    expect(invited.ms).toBeGreaterThanOrEqual(299);
    expect(stranger.ms).toBeGreaterThanOrEqual(299);
    expect(Math.abs(invited.ms - stranger.ms)).toBeLessThan(50);
  });

  it("refuses a second code for an email within a minute and a sixth within an hour, from any address, alike for every email", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    const start = Date.now();
    const refusals = [];
    for (const email of ["friend@example.com", "stranger@example.com"]) {
      vi.setSystemTime(start);
      expect((await requestCode(email, { ip: "203.0.113.1" })).status).toBe(200);
      const again = await requestCode(email, { ip: "203.0.113.2" });
      expect(Number(again.headers.get("x-retry-after"))).toBe(60);
      refusals.push(await reply(again));

      for (let i = 1; i < 5; i++) {
        vi.setSystemTime(start + i * (MINUTE + 1000));
        expect((await requestCode(email, { ip: `203.0.113.${10 + i}` })).status).toBe(200);
      }
      vi.setSystemTime(start + 10 * MINUTE);
      const sixth = await requestCode(email, { ip: "203.0.113.20" });
      expect(Number(sixth.headers.get("x-retry-after"))).toBe(50 * 60);
      refusals.push(await reply(sixth));

      vi.setSystemTime(start + 60 * MINUTE + 1000);
      expect((await requestCode(email, { ip: "203.0.113.21" })).status).toBe(200);
    }

    expect(refusals.map((r) => r.status)).toEqual([429, 429, 429, 429]);
    expect(refusals[2]).toEqual(refusals[0]);
    expect(refusals[3]).toEqual(refusals[1]);
    expect(mailer.sent.filter((m) => m.to === "friend@example.com")).toHaveLength(6);
    expect(mailer.sent.filter((m) => m.to === "stranger@example.com")).toEqual([]);
  });

  it("keeps an email's limit across a restart", async () => {
    expect((await requestCode("friend@example.com")).status).toBe(200);
    expect((await requestCode("friend@example.com", { ip: "203.0.113.2", via: auth() })).status).toBe(429);
  });

  it("refuses more than 20 code requests an hour from one address, kept in the database across a restart", async () => {
    for (let i = 0; i < 20; i++) expect((await requestCode(`stranger${i}@example.com`)).status).toBe(200);

    const refused = await requestCode("friend@example.com", { via: auth() });
    expect(refused.status).toBe(429);
    expect(mailer.sent).toEqual([]);
    expect((await requestCode("friend@example.com", { ip: "203.0.113.2" })).status).toBe(200);

    await ctx.db.delete(rateLimit);
    expect((await requestCode("stranger20@example.com")).status).toBe(200);
  });

  it("is refused without a Turnstile token, or with one Cloudflare rejects, and sends nothing", async () => {
    expect((await requestCode("friend@example.com", { token: null })).status).toBe(400);
    expect((await requestCode("friend@example.com", { token: "turnstile-fail" })).status).toBe(403);
    expect(mailer.sent).toEqual([]);
  });

  it("doesn't hold Google sign-in to Turnstile", async () => {
    const res = await auth().handler(
      new Request(`${BASE_URL}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { origin: BASE_URL, "content-type": "application/json", "x-forwarded-for": "203.0.113.1" },
        body: JSON.stringify({ provider: "google", callbackURL: `${BASE_URL}/` }),
      }),
    );
    expect(res.status).toBe(200);
  });
});
