import { z } from "zod";
import { createDb } from "./db/client";
import { invite, normaliseEmail } from "./domain/allowlist";
import { siteUrl } from "./lib/site-url";

// `pnpm invite <email>`: lets one more person sign in while signup is allowlist-only, with the invited
// monthly budget. Sends nothing; the owner shares the printed URL themselves.
const email = process.argv[2] ?? "";
if (!z.email().safeParse(email.trim()).success) {
  console.error("Usage: pnpm invite <email>");
  process.exit(1);
}
const { db, pool } = createDb(process.env.DATABASE_URL!);
const url = await invite(db, email, siteUrl());
await pool.end();
console.log(`Invited ${normaliseEmail(email)}. They sign in at ${url}`);
// While Google's consent screen is in Testing, Google itself turns away anyone not on its test-user list.
console.log(`Add ${normaliseEmail(email)} as a Google test user: Google Cloud Console → Google Auth Platform → Audience → Test users → Add users.`);
