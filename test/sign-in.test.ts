import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { allowedEmail, session, user, verification } from "../src/db/schema";
import { invite } from "../src/domain/allowlist";
import { createAuth, type SignupMode } from "../src/lib/auth";
import { resendMailer } from "../src/lib/mailer";
import { fakeMailer } from "./fakes";
import { useTestDb } from "./harness";

const BASE_URL = "https://marginalia.test";
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const GOOGLE = { clientId: "client-id", clientSecret: "client-secret" };

describe("Signing in with an email code", () => {
  const ctx = useTestDb();
  let mailer: ReturnType<typeof fakeMailer>;
  const auth = (signupMode: SignupMode = "allowlist") => createAuth(ctx.db, { mailer, signupMode, baseURL: BASE_URL, secret: "s".repeat(32), google: GOOGLE, turnstileSecretKey: "secret", codeReplyMs: 0 });
  const sendCode = (email: string, signupMode?: SignupMode) => auth(signupMode).api.sendVerificationOTP({ body: { email, type: "sign-in" } });
  const signIn = (email: string, otp: string, signupMode?: SignupMode) => auth(signupMode).api.signInEmailOTP({ body: { email, otp } });

  beforeEach(() => {
    mailer = fakeMailer();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends an invited email a plain 6-digit code from Marginalia, and signing in with it makes them a Reader for about 90 days", async () => {
    await invite(ctx.db, "Friend@Example.com", BASE_URL);
    expect(await sendCode("friend@example.com")).toEqual({ success: true });

    expect(mailer.sent).toHaveLength(1);
    const [mail] = mailer.sent;
    expect(mail).toMatchObject({ from: "Marginalia <hello@inkmarginalia.com>", to: "friend@example.com" });
    const code = mailer.codeFor("friend@example.com");
    expect(mail.subject).toBe(`Your Marginalia code: ${code}`);
    expect(mail.text.split("\n")[0]).toBe(`Your Marginalia sign-in code is ${code}.`);
    expect(mail.text).toContain("expires in 5 minutes");
    expect(mail.text).toContain("didn’t ask for this");

    const { user: reader, token } = await signIn("friend@example.com", mailer.codeFor("friend@example.com"));
    expect(reader.email).toBe("friend@example.com");
    const [row] = await ctx.db.select().from(session).where(eq(session.token, token));
    expect(row.userId).toBe(reader.id);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(89 * DAY);
  });

  it("lets an existing Reader in to their own library without an invitation", async () => {
    const [existing] = await ctx.db.select().from(user).where(eq(user.id, ctx.userId));
    await sendCode(existing.email);
    const { user: reader } = await signIn(existing.email, mailer.codeFor(existing.email));
    expect(reader.id).toBe(ctx.userId);
    expect(await ctx.db.select().from(user)).toHaveLength(1);
  });

  it("gives an unknown email the same reply as an invited one, and sends, stores and creates nothing", async () => {
    await invite(ctx.db, "friend@example.com", BASE_URL);
    const invited = await sendCode("friend@example.com");
    mailer.sent.length = 0;
    await ctx.db.delete(verification);

    expect(await sendCode("stranger@example.com")).toEqual(invited);
    expect(mailer.sent).toEqual([]);
    expect(await ctx.db.select().from(verification)).toEqual([]);
    await expect(signIn("stranger@example.com", "123456")).rejects.toThrow();
    expect(await ctx.db.select().from(user).where(eq(user.email, "stranger@example.com"))).toEqual([]);
  });

  it("in open mode, sends anyone a code and makes them a Reader", async () => {
    await sendCode("stranger@example.com", "open");
    const { user: reader } = await signIn("stranger@example.com", mailer.codeFor("stranger@example.com"), "open");
    expect(reader.email).toBe("stranger@example.com");
  });

  it("stores the code hashed, and refuses it after 5 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    await invite(ctx.db, "friend@example.com", BASE_URL);
    await sendCode("friend@example.com");
    const code = mailer.codeFor("friend@example.com");
    const [stored] = await ctx.db.select().from(verification);
    expect(stored.value).not.toContain(code);

    vi.setSystemTime(Date.now() + 5 * MINUTE + 1000);
    await expect(signIn("friend@example.com", code)).rejects.toThrow();
  });

  it("refuses even the right code after 3 wrong ones", async () => {
    await invite(ctx.db, "friend@example.com", BASE_URL);
    await sendCode("friend@example.com");
    const code = mailer.codeFor("friend@example.com");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) await expect(signIn("friend@example.com", wrong)).rejects.toThrow();
    await expect(signIn("friend@example.com", code)).rejects.toThrow();
    expect(await ctx.db.select().from(user).where(eq(user.email, "friend@example.com"))).toEqual([]);
  });
});

describe("pnpm invite", () => {
  const ctx = useTestDb();

  it("allowlists the email, lowercased, with a $5 monthly budget, once however often it runs, and gives the sign-in URL", async () => {
    expect(await invite(ctx.db, " Friend@Example.com ", "https://inkmarginalia.com")).toBe("https://inkmarginalia.com/sign-in");
    await invite(ctx.db, "friend@example.com", "https://inkmarginalia.com");
    expect(await ctx.db.select({ email: allowedEmail.email, usd: allowedEmail.monthlyBudgetUsd }).from(allowedEmail)).toEqual([
      { email: "friend@example.com", usd: 5 },
    ]);
  });
});

// Resend refuses (a quota or rate limit reached, a key revoked) or can't be reached (#70). Asked for as
// the browser asks, through the handler, with Turnstile's siteverify faked to pass.
describe("A sign-in code that fails to send", () => {
  const ctx = useTestDb();
  const EMAIL = "friend@example.com";
  let logged: MockInstance<typeof console.error>;
  const requestCode = (signupMode: SignupMode) =>
    createAuth(ctx.db, { mailer: resendMailer("re_test"), signupMode, baseURL: BASE_URL, secret: "s".repeat(32), google: GOOGLE, turnstileSecretKey: "secret", codeReplyMs: 0 }).handler(
      new Request(`${BASE_URL}/api/auth/email-otp/send-verification-otp`, {
        method: "POST",
        headers: { origin: BASE_URL, "content-type": "application/json", "x-forwarded-for": "203.0.113.1", "x-captcha-response": "token" },
        body: JSON.stringify({ email: EMAIL, type: "sign-in" }),
      }),
    );
  const resendReplies = (reply: () => Response) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (String(url).startsWith("https://api.resend.com") ? reply() : Response.json({ success: true }))),
    );
  // Resend's error for a quota, with an address in its message, as some of its messages have.
  const quotaReached = () => Response.json({ statusCode: 429, name: "daily_quota_exceeded", message: `Could not send to ${EMAIL}: daily quota exceeded.` }, { status: 429 });
  const loggedText = () => logged.mock.calls.flat().map(String).join(" ");

  beforeEach(() => {
    logged = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("in open mode, tells the browser no code went out, and logs Resend's status and error name but never the email", async () => {
    resendReplies(quotaReached);
    const res = await requestCode("open");

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "CODE_NOT_SENT" });
    expect(logged).toHaveBeenCalledOnce();
    expect(loggedText()).toContain("429 daily_quota_exceeded");
    expect(loggedText()).not.toContain(EMAIL);
  });

  it("in open mode, says the same when Resend can't be reached", async () => {
    resendReplies(() => {
      throw new TypeError("fetch failed");
    });
    const res = await requestCode("open");

    expect(res.status).toBe(503);
    expect(loggedText()).not.toContain(EMAIL);
  });

  it("while allowlist-only, gives the reply everyone gets, so a failure doesn't reveal who is invited, and logs it without the email", async () => {
    await invite(ctx.db, EMAIL, BASE_URL);
    resendReplies(quotaReached);
    const res = await requestCode("allowlist");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    await vi.waitFor(() => expect(logged).toHaveBeenCalled());
    expect(loggedText()).toContain("429 daily_quota_exceeded");
    expect(loggedText()).not.toContain(EMAIL);
  });
});
