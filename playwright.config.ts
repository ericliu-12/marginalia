import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl } from "./test/e2e/database";

// A production build on its own port and database, so it runs beside `pnpm dev`. The API keys are
// placeholders: nothing the tests do calls out, and anything that tried would fail rather than spend.
// The Google Books key is blank, which turns off the description lookup when a Book is added from search.
const PORT = 3100;

export default defineConfig({
  testDir: "test/e2e",
  // One database, reset before each test.
  workers: 1,
  fullyParallel: false,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
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
    },
  },
});
