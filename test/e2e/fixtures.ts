import { test as base } from "@playwright/test";
import { fakeTurnstile } from "./turnstile";

// Playwright's test, with Turnstile faked in each test's browser context: for the specs that reach sign-in.
export const test = base.extend({
  context: async ({ context }, use) => {
    await fakeTurnstile(context);
    await use(context);
  },
});
export { expect } from "@playwright/test";
