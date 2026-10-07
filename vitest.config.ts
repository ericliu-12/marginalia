import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    // One shared test database; files must not run concurrently.
    fileParallelism: false,
    // Every run also leaves a JSON report (each test's name, status and error) in vitest-results/: one
    // per run, kept, so an intermittent failure survives the rerun that passes, plus the latest.
    reporters: [
      "default",
      ["json", { outputFile: `vitest-results/run-${new Date().toISOString().replace(/[:.]/g, "-")}.json` }],
      ["json", { outputFile: "vitest-results/last-run.json" }],
    ],
  },
});
