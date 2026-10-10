import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl } from "./test/e2e/database";
import { E2E_OUTBOX } from "./test/e2e/mail";
import { TURNSTILE_PASSES } from "./test/e2e/turnstile";
import { E2E_CATALOG } from "./test/e2e/open-library";
import { E2E_AUTH_SECRET, signedIn } from "./test/e2e/session";
import { E2E_PORT } from "./test/worktree";

// A production build on its own port and database, so it runs beside `pnpm dev` (and, in a ticket's
// worktree, beside the other checkouts' e2e runs: see test/worktree.ts). The API keys are
// placeholders: nothing the tests do calls out, and anything that tried would fail rather than spend.
// The Google Books key is blank, which turns off the description lookup when a Book is added from search,
// and Open Library's works come from a file the tests write (test/e2e/open-library.ts).
const PORT = E2E_PORT;

export default defineConfig({
  testDir: "test/e2e",
  // One database, reset before each test.
  workers: 1,
  fullyParallel: false,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", storageState: signedIn() },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `pnpm exec tsx test/e2e/create-database.ts && pnpm exec next build && pnpm exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: e2eDatabaseUrl(),
      ANTHROPIC_API_KEY: "e2e-no-calls",
      VOYAGE_API_KEY: "e2e-no-calls",
      GOOGLE_BOOKS_API_KEY: "",
      MONTHLY_AI_BUDGET_USD: "8",
      GOOGLE_CLIENT_ID: "e2e-no-calls",
      GOOGLE_CLIENT_SECRET: "e2e-no-calls",
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
      BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
      // Cloudflare's test keys: a site key that always passes, and a secret that accepts its token.
      TURNSTILE_SITE_KEY: TURNSTILE_PASSES,
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      MAIL_OUTBOX_FILE: E2E_OUTBOX,
      OPEN_LIBRARY_FIXTURE_FILE: E2E_CATALOG,
    },
  },
});
