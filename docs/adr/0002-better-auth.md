# Readers sign in with Better Auth, in our own Postgres

Status: accepted, 2026-10-09 (#45)

Opening Marginalia to public signup needs real accounts. We chose Better Auth (self-hosted, Drizzle adapter, its tables in our Postgres) over Clerk and Auth.js. Clerk would put every Reader's email and session at another vendor, against the private-by-default principle and ADR 0001's one-project shape. Auth.js has no built-in email-code sign-in (it would be hand-built on its magic links) and its passkeys are experimental. Better Auth covers Google sign-in, a 6-digit email code (sent through Resend), account linking by verified email, database-stored rate limits and account deletion out of the box. With `disableSignUp`, it also covers the allowlist mode, so opening signup later is only a setting.

Sign-in is a code, not a magic link, because the iPhone home-screen app keeps cookies apart from Safari: a link opened from Mail would sign in Safari, not the app. Google's redirect has the same risk, so #45 starts with a spike on a real iPhone. If Google's sign-in finishes outside the app, the fallback is a hand-off: the app polls with a single-use ID that ties the session to it.

## Consequences

- Better Auth's `user` is our existing `user` table, with the columns it needs added. Ids stay uuids.
- Auth callbacks use `https://inkmarginalia.com`. The Railway host redirects there with a 308, so it never signs anyone in.
- While signup is allowlist-only, a code is sent only to an allowlisted email or an existing Reader's, and every other email gets the same neutral reply. That way the reply doesn't reveal who is on the list, and strangers can't use our sender to email other people.
