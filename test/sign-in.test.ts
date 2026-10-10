import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("A sign-in code that fails to send", () => {
  const ctx = useTestDb();
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("is logged with Resend's error, since the request doesn't wait for it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"message":"The domain is not verified"}', { status: 403 })));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const auth = createAuth(ctx.db, { mailer: resendMailer("re_test"), signupMode: "open", baseURL: BASE_URL, secret: "s".repeat(32), google: GOOGLE, turnstileSecretKey: "secret", codeReplyMs: 0 });

    expect(await auth.api.sendVerificationOTP({ body: { email: "friend@example.com", type: "sign-in" } })).toEqual({ success: true });
    await vi.waitFor(() => expect(logged).toHaveBeenCalled());
    const [message, error] = logged.mock.calls[0];
    expect(message).toBe("Could not send a sign-in code to friend@example.com");
    expect(String(error)).toContain("403");
    expect(String(error)).toContain("The domain is not verified");
  });
});
