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
