import { expect, test } from "@playwright/test";
import { seedLibrary } from "./database";

// The wordmark sits at the same height on every page at phone width, so tapping Account, or a link
// in the footer, doesn't make the top of the page jump.

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.beforeEach(async () => {
  await seedLibrary();
});

test("the wordmark's top is the library's on the graph, account, privacy and terms pages", async ({ page }) => {
  const wordmarkTop = async (path: string) => {
    await page.goto(path);
    return (await page.getByText("Marginalia", { exact: true }).first().boundingBox())!.y;
  };
  const library = await wordmarkTop("/");
  for (const path of ["/graph", "/account", "/privacy", "/terms"]) {
    expect(await wordmarkTop(path), path).toBe(library);
  }
});
