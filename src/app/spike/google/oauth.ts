// Spike for #59, removed by #63: does Google sign-in started from the iPhone home-screen app come
// back into the app with its cookie, or end in Safari? A bare OAuth code flow, nothing kept but a
// cookie naming the Google account, so the answer doesn't depend on Better Auth.

export const STATE_COOKIE = "spike_google_state";
export const SIGNED_IN_COOKIE = "spike_google_email";

// Where Google sends the reader back. BETTER_AUTH_URL (https://inkmarginalia.com in production, as
// #63 will need) and not the request's host, so the Railway host can't start a sign-in.
export const redirectUri = (requestOrigin: string) => `${process.env.BETTER_AUTH_URL ?? requestOrigin}/spike/google/callback`;

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/spike/google",
  maxAge,
});
