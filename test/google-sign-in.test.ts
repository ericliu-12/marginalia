import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { account, session, user } from "../src/db/schema";
import { invite } from "../src/domain/allowlist";
import { createAuth } from "../src/lib/auth";
import { fakeMailer } from "./fakes";
import { useTestDb } from "./harness";

const BASE_URL = "https://marginalia.test";
// As behind Railway's proxy: the request reaches the server at its own address, with another Host.
const SERVER = "https://localhost:8080";
const PROXIED = { host: "inkmarginalia.example", "x-forwarded-host": "inkmarginalia.example", "x-forwarded-proto": "https" };
// Better Auth's session cookie, given the __Secure- prefix on an https site.
const SESSION_COOKIE = "__Secure-better-auth.session_token";

type Profile = { sub: string; email: string; email_verified: boolean };
// Google's id token, as its token endpoint returns it. Better Auth reads it without checking the
// signature (it came straight from Google over TLS), so an unsigned one stands in.
const idToken = (profile: Profile) =>
  [{ alg: "RS256", typ: "JWT" }, { iss: "https://accounts.google.com", aud: "client-id", name: "A Reader", ...profile }, "sig"]
    .map((part) => (typeof part === "string" ? part : Buffer.from(JSON.stringify(part)).toString("base64url")))
    .join(".");

describe("Continue with Google", () => {
  const ctx = useTestDb();
  let mailer: ReturnType<typeof fakeMailer>;
  const auth = () =>
    createAuth(ctx.db, {
      mailer,
      signupMode: "allowlist",
      baseURL: BASE_URL,
      secret: "s".repeat(32),
      google: { clientId: "client-id", clientSecret: "client-secret" },
      turnstileSecretKey: "secret",
      codeReplyMs: 0,
    });

  beforeEach(() => {
    mailer = fakeMailer();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const start = async () => {
    const res = await auth().handler(
      new Request(`${SERVER}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { ...PROXIED, origin: BASE_URL, "content-type": "application/json" },
        body: JSON.stringify({ provider: "google", callbackURL: `${BASE_URL}/graph` }),
      }),
    );
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    return { google: new URL(((await res.json()) as { url: string }).url), cookie };
  };

  // Comes back from Google as the given account: only Google's token endpoint is faked.
  const signInWithGoogle = async (profile: Profile) => {
    const { google, cookie } = await start();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ access_token: "access", token_type: "Bearer", expires_in: 3600, id_token: idToken(profile) })),
    );
    const res = await auth().handler(
      new Request(`${SERVER}/api/auth/callback/google?code=code&state=${google.searchParams.get("state")}`, { headers: { ...PROXIED, cookie } }),
    );
    vi.unstubAllGlobals();
    const sessionCookie = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    return { location: res.headers.get("location"), sessionCookie };
  };

  const signInWithCode = async (email: string) => {
    await auth().api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    return (await auth().api.signInEmailOTP({ body: { email, otp: mailer.codeFor(email) } })).user;
  };

  const readerOf = async (sessionCookie: string | undefined) => {
    const token = decodeURIComponent(sessionCookie!.split(";")[0].split("=")[1]).split(".")[0];
    const [row] = await ctx.db.select({ userId: session.userId }).from(session).where(eq(session.token, token));
    return row?.userId;
  };

  it("sends the Reader to Google with the callback on BETTER_AUTH_URL, whatever address the request came in on", async () => {
    const { google } = await start();
    expect(google.origin + google.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(google.searchParams.get("redirect_uri")).toBe(`${BASE_URL}/api/auth/callback/google`);
    expect(google.searchParams.get("prompt")).toBe("select_account");
  });

  it("signs a Reader who signed up with an email code in to the same library, and returns them on BETTER_AUTH_URL", async () => {
    const [owner] = await ctx.db.select().from(user).where(eq(user.id, ctx.userId));
    await signInWithCode(owner.email);

    const { location, sessionCookie } = await signInWithGoogle({ sub: "google-1", email: owner.email.toUpperCase(), email_verified: true });
    expect(location).toBe(`${BASE_URL}/graph`);
    expect(sessionCookie).not.toMatch(/domain=/i);
    expect(await readerOf(sessionCookie)).toBe(ctx.userId);
    expect(await ctx.db.select({ userId: account.userId }).from(account).where(eq(account.providerId, "google"))).toEqual([{ userId: ctx.userId }]);
    expect(await ctx.db.select().from(user)).toHaveLength(1);

    // And again, through the account it now has.
    expect(await readerOf((await signInWithGoogle({ sub: "google-1", email: owner.email, email_verified: true })).sessionCookie)).toBe(ctx.userId);
  });

  it("signs a Reader whose email is verified in to their library with Google, without an email code first", async () => {
    await ctx.db.update(user).set({ email: "owner@example.com", emailVerified: true }).where(eq(user.id, ctx.userId));
    const { sessionCookie } = await signInWithGoogle({ sub: "google-5", email: "owner@example.com", email_verified: true });
    expect(await readerOf(sessionCookie)).toBe(ctx.userId);
  });

  it("opens the same library with an email code for an invited Reader who first came with Google", async () => {
    await invite(ctx.db, "friend@example.com", BASE_URL);
    const { sessionCookie } = await signInWithGoogle({ sub: "google-2", email: "friend@example.com", email_verified: true });
    const viaGoogle = await readerOf(sessionCookie);
    expect(viaGoogle).toBeDefined();

    expect((await signInWithCode("friend@example.com")).id).toBe(viaGoogle);
    expect(await ctx.db.select().from(user).where(eq(user.email, "friend@example.com"))).toHaveLength(1);
  });

  it("does not link a Google account whose email Google hasn't verified", async () => {
    const [owner] = await ctx.db.select().from(user).where(eq(user.id, ctx.userId));
    await signInWithCode(owner.email);

    const { location, sessionCookie } = await signInWithGoogle({ sub: "google-3", email: owner.email, email_verified: false });
    expect(location).toMatch(new RegExp(`^${BASE_URL}/sign-in\\?error=`));
    expect(sessionCookie).toBeUndefined();
    expect(await ctx.db.select().from(account).where(eq(account.providerId, "google"))).toEqual([]);
  });

  it("creates nothing for an email that is neither invited nor a Reader's, and sends them back to /sign-in on BETTER_AUTH_URL", async () => {
    const { location, sessionCookie } = await signInWithGoogle({ sub: "google-4", email: "stranger@example.com", email_verified: true });
    expect(location).toMatch(new RegExp(`^${BASE_URL}/sign-in\\?error=`));
    expect(sessionCookie).toBeUndefined();
    expect(await ctx.db.select().from(user).where(eq(user.email, "stranger@example.com"))).toEqual([]);
    expect(await ctx.db.select().from(account)).toEqual([]);
    expect(await ctx.db.select().from(session)).toEqual([]);
  });

  it("sends a return from Google that it can't match to a sign-in back to /sign-in on BETTER_AUTH_URL", async () => {
    const res = await auth().handler(new Request(`${SERVER}/api/auth/callback/google?code=code&state=forged`, { headers: PROXIED }));
    expect(res.headers.get("location")).toMatch(new RegExp(`^${BASE_URL}/sign-in\\?error=`));
  });
});
