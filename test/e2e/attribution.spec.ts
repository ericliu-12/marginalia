import { expect, test } from "@playwright/test";
import { readingBook, seedLibrary } from "./database";

// A summary grounded in Google's description links to the Book's Google Books page (#42); one
// grounded elsewhere says nothing about Google.

test("a summary drawn from Google Books links to the Book's page there", async ({ page }) => {
  await seedLibrary();
  await readingBook("Piranesi", "gb-piranesi");
  await readingBook("Middlemarch");
  await page.goto("/");
  const about = page.getByRole("region", { name: "About this book" });

  await page.getByRole("main").getByRole("button", { name: "Piranesi", exact: true }).click();
  await expect(about.getByText("Piranesi.")).toBeVisible();
  const link = about.getByRole("link", { name: "Google Books" });
  await expect(link).toHaveAttribute("href", "https://books.google.com/books?id=gb-piranesi");
  await expect(link).toHaveAttribute("target", "_blank");

  await page.getByRole("main").getByRole("button", { name: "Middlemarch", exact: true }).click();
  await expect(about.getByText("Middlemarch.")).toBeVisible();
  await expect(about.getByRole("link", { name: "Google Books" })).toHaveCount(0);
});
