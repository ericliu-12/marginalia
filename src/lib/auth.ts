import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { captcha } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins/email-otp";
import { appDb, type Db } from "@/db/client";
import * as schema from "@/db/schema";
import { mayBecomeReader, uninvite } from "@/domain/allowlist";
import { takeCodeRequest } from "@/domain/code-requests";
import { clientAddress } from "./client-address";
import { appMailer, signInCodeMail, type Mailer } from "./mailer";
import { siteUrl } from "./site-url";

// Readers sign in with Better Auth, in our Postgres (ADR 0002).

const DAY_SECONDS = 24 * 60 * 60;
// Deleting the account takes a session signed in less than this long ago (#68).
export const FRESH_SESSION_S = DAY_SECONDS;
const SEND_CODE = "/email-otp/send-verification-otp";
const DELETE_ACCOUNT = "/delete-user";
// Where the handler puts the client's address for Better Auth, as clientAddress reads it.
const CLIENT_ADDRESS = "x-client-address";
// Every reply to a code request takes at least this long, longer than the work behind any of them, so
// its timing doesn't tell an email that may sign in from one that may not (#65).
const CODE_REPLY_MS = 1000;

// `allowlist` (the default): only an invited email or an existing Reader's may sign in. `open`: anyone.
export type SignupMode = "allowlist" | "open";
export const signupMode = (env: Record<string, string | undefined> = process.env): SignupMode => (env.SIGNUP_MODE === "open" ? "open" : "allowlist");

type AuthConfig = {
  mailer: Mailer;
  signupMode: SignupMode;
  baseURL: string;
  secret: string;
  google: { clientId: string; clientSecret: string };
  turnstileSecretKey: string;
  codeReplyMs: number;
};

export function createAuth(db: Db, config: AuthConfig) {
  const allowed = (email: string) => config.signupMode === "open" || mayBecomeReader(db, email);
  const auth = betterAuth({
    // Every absolute URL comes from here, never from the request (see siteUrl).
    baseURL: config.baseURL,
    secret: config.secret,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    // About 90 days, renewed once a day as the app is used, so the iPhone home-screen app stays signed in.
    session: { expiresIn: 90 * DAY_SECONDS, updateAge: DAY_SECONDS, freshAge: FRESH_SESSION_S },
    // Google's callback is ${baseURL}/api/auth/callback/google, the redirect URI on the Google OAuth client.
    // Google always asks which account, so a Reader with two isn't signed in with the wrong one unasked.
    socialProviders: { google: { ...config.google, prompt: "select_account" } },
    // Google joins the Reader with the same email, if Google has verified it (it isn't a trusted provider,
    // so its say-so alone isn't enough) and so has an email code. A code finds a Google Reader by email too.
    account: { accountLinking: { enabled: true } },
    // A sign-in with Google that fails, for whatever reason, comes back to the sign-in page with `?error=`.
    onAPIError: { errorURL: new URL("/sign-in", config.baseURL).toString() },
    // In the database, so a restart doesn't reset them.
    rateLimit: { enabled: true, storage: "database", customRules: { [SEND_CODE]: { window: 60 * 60, max: 20 } } },
    // Uuids, as our ids are; not "uuid", which would also replace the ids Better Auth sets itself.
    // The client's address is the first in x-forwarded-for, which Railway's edge sets (Cloudflare's DNS
    // isn't proxied, so there's no cf-connecting-ip). Better Auth would refuse a list of addresses and put
    // every such request in one shared bucket, so the handler reads it with clientAddress instead.
    advanced: { database: { generateId: () => randomUUID() }, ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS] } },
    // Delete your account (#68). Better Auth refuses a session that isn't fresh (signed in a day or more ago),
    // then deletes the user row, which takes everything the Reader owns with it (#93), and every session.
    // Their allowlist row goes too, so signing up again takes a fresh invitation.
    user: { deleteUser: { enabled: true, beforeDelete: (reader) => uninvite(db, reader.email) } },
    hooks: {
      // An email that may not sign in gets the reply everyone gets, and no code is made or sent, so the
      // reply doesn't reveal who is on the allowlist and strangers can't use our sender. Its limits come
      // first, and are the same for every email.
      before: createAuthMiddleware(async (ctx) => {
        // Only once the Reader has typed `delete`.
        if (ctx.path === DELETE_ACCOUNT && ctx.body?.confirm !== "delete")
          throw new APIError("BAD_REQUEST", { message: "Type delete to delete your account.", code: "NOT_CONFIRMED" });
        if (ctx.path !== SEND_CODE) return;
        const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
        const refused = await takeCodeRequest(db, email);
        if (refused)
          throw new APIError("TOO_MANY_REQUESTS", { message: "Too many requests. Please try again later." }, { "X-Retry-After": String(refused.retryAfterS) });
        if (!(await allowed(email))) return ctx.json({ success: true });
      }),
    },
    databaseHooks: {
      user: { create: { before: async (reader) => ((await allowed(reader.email)) ? undefined : false) } },
    },
    plugins: [
      // Only on asking for a code: the browser sends Turnstile's token as x-captcha-response.
      captcha({ provider: "cloudflare-turnstile", secretKey: config.turnstileSecretKey, endpoints: [SEND_CODE] }),
      emailOTP({
        otpLength: 6,
        expiresIn: 5 * 60,
        allowedAttempts: 3,
        storeOTP: "hashed",
        // Not awaited, so the reply takes as long whether or not an email goes out.
        async sendVerificationOTP({ email, otp }) {
          config.mailer.send(signInCodeMail(email, otp)).catch((err) => console.error(`Could not send a sign-in code to ${email}`, err));
        },
      }),
    ],
  });

  async function handler(received: Request) {
    // Set on every request, over any a client sent itself.
    const headers = new Headers(received.headers);
    headers.set(CLIENT_ADDRESS, clientAddress(received.headers));
    const request = new Request(received, { headers });
    // As Better Auth matches paths: extra and trailing slashes reach the same endpoint.
    const path = new URL(request.url).pathname.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1");
    if (path !== `/api/auth${SEND_CODE}`) return auth.handler(request);
    const held = new Promise((resolve) => setTimeout(resolve, config.codeReplyMs));
    const response = await auth.handler(request);
    await held;
    return response;
  }
  return { ...auth, handler };
}

export type Auth = ReturnType<typeof createAuth>;

let shared: Auth | undefined;

// The app's Better Auth.
export function appAuth(): Auth {
  shared ??= createAuth(appDb(), {
    mailer: appMailer(),
    signupMode: signupMode(),
    baseURL: siteUrl(),
    secret: process.env.BETTER_AUTH_SECRET ?? "",
    google: { clientId: process.env.GOOGLE_CLIENT_ID ?? "", clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "" },
    turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY ?? "",
    codeReplyMs: CODE_REPLY_MS,
  });
  return shared;
}
