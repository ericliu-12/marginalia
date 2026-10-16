import { expect, test, type Page } from "@playwright/test";
import { seedLibrary, wantBook } from "./database";

// The desktop's Status moves, on a library row and in the Book's panel: a click made while a move is
// still saving goes through, and the last one stands.

test.beforeEach(async ({ page }) => {
  await seedLibrary();
  await wantBook("Gilead");
  await page.goto("/");
});

const library = (page: Page) => page.getByRole("main");
const inSection = (page: Page, section: RegExp) => library(page).getByRole("region", { name: section }).getByRole("button", { name: "Gilead", exact: true });

// Holds the first Status move, as on a slow connection, until it is let go.
async function holdFirstMove(page: Page) {
  const held: import("@playwright/test").Route[] = [];
  await page.route("**/*", (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.headers()["next-action"] && /"(reading|read|want)"/.test(req.postData() ?? "") && held.length === 0) return void held.push(route);
    return route.fallback();
  });
  return {
    held: () => expect.poll(() => held.length).toBe(1),
    release: () => held[0].fallback(),
  };
}

test("a library row takes a second move while the first is saving", async ({ page }) => {
  const moves = page.getByRole("group", { name: "Change status of Gilead" });
  const move = await holdFirstMove(page);
  await library(page).getByRole("listitem").filter({ hasText: "Gilead" }).hover();
  await moves.getByRole("button", { name: "Start reading: Gilead" }).click();
  await move.held();
  await moves.getByRole("button", { name: "Mark finished: Gilead" }).click();
  await move.release();
  await expect(inSection(page, /^Read(?!ing)/)).toBeVisible();
  await expect(page.getByText("1 book finding connections")).toBeVisible();
});

test("the Book's panel takes a second move while the first is saving", async ({ page }) => {
  await inSection(page, /^Want to read/).click();
  const status = page.getByRole("group", { name: "Status of Gilead", exact: true });
  const move = await holdFirstMove(page);
  await status.getByRole("button", { name: "Start reading" }).click();
  await move.held();
  await status.getByRole("button", { name: "Mark finished" }).click();
  await move.release();
  await expect(status.getByText("Read", { exact: true })).toBeVisible();
  await expect(inSection(page, /^Read(?!ing)/)).toBeVisible();
});

test("a move that lands after the panel has gone to another Book shows when the Book is opened again", async ({ page }) => {
  await inSection(page, /^Want to read/).click();
  const status = page.getByRole("group", { name: "Status of Gilead", exact: true });
  const move = await holdFirstMove(page);
  await status.getByRole("button", { name: "Start reading" }).click();
  await move.held();
  await library(page).getByRole("button", { name: "Stoner", exact: true }).click();
  await expect(page.getByRole("group", { name: "Status of Stoner", exact: true })).toBeVisible();
  await move.release();
  await expect(inSection(page, /^Reading/)).toBeVisible();
  await inSection(page, /^Reading/).click();
  await expect(status.getByText("Reading", { exact: true })).toBeVisible();
});
