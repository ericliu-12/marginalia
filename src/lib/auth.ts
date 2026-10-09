import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import { appDb, type Db } from "@/db/client";
import * as schema from "@/db/schema";
import { mayBecomeReader } from "@/domain/allowlist";
import { appMailer, signInCodeMail, type Mailer } from "./mailer";

// Readers sign in with Better Auth, in our Postgres (ADR 0002).

const DAY_SECONDS = 24 * 60 * 60;

// `allowlist` (the default): only an invited email or an existing Reader's may sign in. `open`: anyone.
export type SignupMode = "allowlist" | "open";
export const signupMode = (env: Record<string, string | undefined> = process.env): SignupMode => (env.SIGNUP_MODE === "open" ? "open" : "allowlist");

type AuthConfig = { mailer: Mailer; signupMode: SignupMode; baseURL: string; secret: string };

export function createAuth(db: Db, config: AuthConfig) {
  const allowed = (email: string) => config.signupMode === "open" || mayBecomeReader(db, email);
  return betterAuth({
    // Every absolute URL comes from here, never from the request: behind Railway's proxy a request's
    // own URL is the server's address (localhost:8080), not the site's.
    baseURL: config.baseURL,
    secret: config.secret,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    // Uuids, as our ids are; not "uuid", which would also replace the ids Better Auth sets itself.
    advanced: { database: { generateId: () => randomUUID() } },
    // About 90 days, renewed once a day as the app is used, so the iPhone home-screen app stays signed in.
    session: { expiresIn: 90 * DAY_SECONDS, updateAge: DAY_SECONDS },
    hooks: {
      // An email that may not sign in gets the reply everyone gets, and no code is made or sent, so the
      // reply doesn't reveal who is on the allowlist and strangers can't use our sender.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/email-otp/send-verification-otp") return;
        const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
        if (!(await allowed(email))) return ctx.json({ success: true });
      }),
    },
    databaseHooks: {
      user: { create: { before: async (reader) => ((await allowed(reader.email)) ? undefined : false) } },
    },
    plugins: [
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
}

export type Auth = ReturnType<typeof createAuth>;

let shared: Auth | undefined;

// The app's Better Auth. BETTER_AUTH_URL is the site's own address (https://inkmarginalia.com in production).
export function appAuth(): Auth {
  shared ??= createAuth(appDb(), {
    mailer: appMailer(),
    signupMode: signupMode(),
    baseURL: siteUrl(),
    secret: process.env.BETTER_AUTH_SECRET ?? "",
  });
  return shared;
}

export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.BETTER_AUTH_URL) return env.BETTER_AUTH_URL;
  if (env.NODE_ENV === "production") throw new Error("BETTER_AUTH_URL is not set.");
  return "http://localhost:3000";
}
