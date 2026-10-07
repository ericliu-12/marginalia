import { createE2eDatabase } from "./database";

// Run by the web server command, before the app starts: Playwright launches the server ahead of any
// global setup, and the app needs its database to answer the readiness check.
await createE2eDatabase();
