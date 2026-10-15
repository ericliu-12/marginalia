import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { manualBook, seedLibrary } from "./database";

// The Book-details form, as Add by hand and as Edit, on a desktop and on a phone: its labels, what it
// says is wrong and where focus goes, and the cover-address rule. Search is answered here with nothing.

const searchFindsNothing = (page: Page) => page.route("**/api/search?**", (route) => route.fulfill({ json: [] }));
// A cover typed in is put in an <img>; it is never fetched from the real host.
const coversAnswered = (page: Page) => page.route("https://www.example.com/**", (route) => route.fulfill({ status: 404 }));
// A NUL passes the form's own check, but Postgres refuses to store it: the save fails on the server.
const UNSTORABLE = "Kitchen\u0000Notes";
// Holds the next Server Function call, as on a slow connection, until it is let go.
async function holdNextCall(page: Page) {
  const held: Route[] = [];
  await page.route("**/*", (route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"] && held.length === 0 ? void held.push(route) : route.fallback(),
  );
  return {
    held: () => expect.poll(() => held.length).toBe(1),
    release: () => held[0].fallback(),
  };
}
const COVER_ERROR = "The cover should be a web address beginning with http:// or https://.";

// Submits, and checks the form says `message` at `field`, which now has focus.
async function wrongAt(form: Locator, submit: string, field: string, message: string) {
  await form.getByRole("button", { name: submit, exact: true }).click();
  await expect(form.getByRole("alert")).toHaveText(message);
  const input = form.getByLabel(field, { exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAccessibleDescription(new RegExp(message.replace(/[.?*+()]/g, "\\$&")));
}

test.describe("on a desktop", () => {
  test.beforeEach(async ({ page }) => {
    await seedLibrary();
    await searchFindsNothing(page);
    await coversAnswered(page);
  });

  const searchPane = (page: Page) => page.getByRole("complementary", { name: "Add a book" });

  test("Add by hand: its fields, each missing field in turn, the cover rule, and a www. cover kept as https", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("searchbox", { name: "Search by title and author" }).fill("Kitchen");
    await searchPane(page).getByRole("button", { name: "Add it by hand" }).click();
    const form = searchPane(page).getByRole("form", { name: "Add a book by hand" });

    await expect(form.getByText("It stays in your library alone, and you can change it later.")).toBeVisible();
    // The title came from the search, so the author is next.
    await expect(form.getByLabel("Author", { exact: true })).toBeFocused();
    await expect(form.getByLabel("Author", { exact: true })).toHaveAccessibleDescription("Separate co-authors with ‘and’.");
    await expect(form.getByLabel("Cover image address")).toHaveCount(0);
    await expect(form.getByLabel("Description")).toHaveCount(0);

    await form.getByLabel("Title").fill("");
    await wrongAt(form, "Want to read", "Title", "A title is needed.");
    // Typing clears what was said.
    await form.getByLabel("Title").fill("Kitchen Notes");
    await expect(form.getByRole("alert")).toHaveCount(0);
    await expect(form.getByLabel("Title")).not.toHaveAttribute("aria-invalid");
    await wrongAt(form, "Reading", "Author", "An author is needed.");
    await expect(form.getByLabel("Author", { exact: true })).toHaveAccessibleDescription(/^Separate co-authors with ‘and’\./);

    await form.getByLabel("Author", { exact: true }).fill("June Ash");
    await form.getByRole("button", { name: "Add a cover" }).click();
    await expect(form.getByLabel("Cover image address")).toBeFocused();
    await expect(form.getByLabel("Cover image address")).toHaveAttribute("placeholder", "https://");
    await form.getByLabel("Cover image address").fill("ftp://example.com/c.jpg");
    await wrongAt(form, "Already read", "Cover image address", COVER_ERROR);

    await form.getByRole("button", { name: "Add a description" }).click();
    await expect(form.getByLabel("Description")).toBeFocused();
    await expect(form.getByLabel("Description")).toHaveAttribute("placeholder", "What it’s about, from the jacket or in your words. It helps Marginalia know the book.");
    await form.getByLabel("Cover image address").fill("www.example.com/c.jpg");
    await form.getByRole("button", { name: "Want to read" }).click();
    await expect(searchPane(page).getByText("Added Kitchen Notes to your library.")).toBeVisible();

    await searchPane(page).getByRole("button", { name: "Kitchen Notes" }).click();
    await page.getByRole("button", { name: "Edit details" }).click();
    await expect(page.getByRole("form", { name: "Edit Kitchen Notes" }).getByLabel("Cover image address")).toHaveValue("https://www.example.com/c.jpg");
  });

  test("Escape closes Add by hand with the draft kept; Cancel discards it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("searchbox", { name: "Search by title and author" }).fill("Kitchen");
    await searchPane(page).getByRole("button", { name: "Add it by hand" }).click();
    const form = searchPane(page).getByRole("form", { name: "Add a book by hand" });
    await form.getByLabel("Author", { exact: true }).fill("June Ash");
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);
    await searchPane(page).getByRole("button", { name: "Add it by hand" }).click();
    await expect(form.getByLabel("Author", { exact: true })).toHaveValue("June Ash");
    await form.getByRole("button", { name: "Cancel" }).click();
    await searchPane(page).getByRole("button", { name: "Add it by hand" }).click();
    await expect(form.getByLabel("Author", { exact: true })).toHaveValue("");
  });

  test("Add by hand says Adding… on the chosen Status while it adds, and says so when the add fails", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("searchbox", { name: "Search by title and author" }).fill("Kitchen");
    await searchPane(page).getByRole("button", { name: "Add it by hand" }).click();
    const form = searchPane(page).getByRole("form", { name: "Add a book by hand" });
    await form.getByLabel("Title").fill(UNSTORABLE);
    await form.getByLabel("Author", { exact: true }).fill("June Ash");

    const call = await holdNextCall(page);
    await form.getByRole("button", { name: "Reading" }).click();
    await call.held();
    const choices = form.getByRole("group", { name: "Add to your library as" }).getByRole("button");
    await expect(choices).toHaveText(["Want to read", "Adding…", "Already read"]);
    for (const choice of await choices.all()) await expect(choice).toBeDisabled();
    await expect(form.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await call.release();

    await expect(form.getByRole("alert")).toHaveText("Couldn’t add this book. Try again.");
    await expect(choices).toHaveText(["Want to read", "Reading", "Already read"]);
    await expect(form.getByLabel("Title")).not.toHaveAttribute("aria-invalid");
  });

  test("Edit, for a Manual Book: its fields, each missing field in turn, and the cover rule", async ({ page }) => {
    await manualBook("Kitchen Notes", "June Ash", "Recipes.");
    await page.goto("/");
    await page.getByRole("main").getByRole("button", { name: "Kitchen Notes", exact: true }).click();
    await page.getByRole("button", { name: "Edit details" }).click();
    const form = page.getByRole("form", { name: "Edit Kitchen Notes" });

    await expect(form.getByText("You added this book by hand, so it’s yours to change.", { exact: false })).toBeVisible();
    await expect(form.getByLabel("Title")).toBeFocused();
    await expect(form.getByLabel("Title")).toHaveValue("Kitchen Notes");
    await expect(form.getByLabel("Author", { exact: true })).toHaveAccessibleDescription("Separate co-authors with ‘and’.");
    await expect(form.getByLabel("Cover image address")).toHaveValue("");
    await expect(form.getByLabel("Cover image address")).toHaveAttribute("placeholder", "https://");
    await expect(form.getByLabel("Description")).toHaveValue("Recipes.");
    await expect(form.getByLabel("Description")).not.toHaveAttribute("placeholder");

    await form.getByLabel("Title").fill("");
    await form.getByLabel("Author", { exact: true }).fill("");
    await wrongAt(form, "Save changes", "Title", "A title is needed.");
    await form.getByLabel("Title").fill("Kitchen Notes");
    await wrongAt(form, "Save changes", "Author", "An author is needed.");
    await form.getByLabel("Author", { exact: true }).fill("June Ash");
    await form.getByLabel("Cover image address").fill("javascript:alert(1)");
    await wrongAt(form, "Save changes", "Cover image address", COVER_ERROR);

    await form.getByLabel("Cover image address").fill("https://www.example.com/c.jpg");
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").getByText("Changes saved.")).toBeVisible();
    await expect(form).toHaveCount(0);
  });

  test("Edit says Saving… while it saves, and says so when the save fails", async ({ page }) => {
    await manualBook("Kitchen Notes", "June Ash", "Recipes.");
    await page.goto("/");
    await page.getByRole("main").getByRole("button", { name: "Kitchen Notes", exact: true }).click();
    await page.getByRole("button", { name: "Edit details" }).click();
    const form = page.getByRole("form", { name: "Edit Kitchen Notes" });
    await form.getByLabel("Title").fill(UNSTORABLE);

    const call = await holdNextCall(page);
    await form.getByRole("button", { name: "Save changes" }).click();
    await call.held();
    await expect(form.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await expect(form.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await call.release();

    await expect(form.getByRole("alert")).toHaveText("Couldn’t save these changes. Try again.");
    await expect(form.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  test("Edit, for a shared Book: title and author only, either may be blank, and Escape leaves it unchanged", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").getByRole("button", { name: "Stoner", exact: true }).click();
    await page.getByRole("button", { name: "Edit title or author" }).click();
    const form = page.getByRole("form", { name: "Edit Stoner" });

    await expect(form.getByLabel("Title")).toBeFocused();
    await expect(form.getByLabel("Author", { exact: true })).toHaveValue("John Williams");
    await expect(form.getByLabel("Author", { exact: true })).not.toHaveAttribute("aria-describedby");
    await expect(form.getByLabel("Cover image address")).toHaveCount(0);
    await expect(form.getByLabel("Description")).toHaveCount(0);

    await form.getByLabel("Title").fill("Stoner (NYRB)");
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);
    const heading = page.getByRole("complementary", { name: /^Notes on / }).getByRole("heading", { level: 2 });
    await expect(heading).toHaveText("Stoner");
    await expect(heading).toBeFocused();

    await page.getByRole("button", { name: "Edit title or author" }).click();
    await form.getByLabel("Title").fill("");
    await form.getByLabel("Author", { exact: true }).fill("");
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").getByText("Changes saved.")).toBeVisible();
    await expect(heading).toHaveText("Stoner");
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await seedLibrary();
    await searchFindsNothing(page);
    await coversAnswered(page);
  });

  const addScreen = (page: Page) => page.getByRole("dialog", { name: "Add a Book" });

  test("Add by hand: Enter's key says next or done, each missing field in turn, and the cover rule", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Add a Book" }).click();
    await addScreen(page).getByRole("searchbox").fill("Kitchen");
    await addScreen(page).getByRole("button", { name: "Add it by hand" }).click();
    const form = addScreen(page).getByRole("form", { name: "Add a book by hand" });

    await expect(form.getByLabel("Title")).toHaveAttribute("enterkeyhint", "next");
    await expect(form.getByLabel("Author", { exact: true })).toHaveAttribute("enterkeyhint", "done");
    await form.getByRole("button", { name: "Add a cover" }).click();
    await expect(form.getByLabel("Author", { exact: true })).toHaveAttribute("enterkeyhint", "next");
    await expect(form.getByLabel("Cover image address")).toHaveAttribute("enterkeyhint", "done");
    await expect(form.getByLabel("Cover image address")).toHaveAttribute("inputmode", "url");

    await form.getByLabel("Title").fill("");
    await wrongAt(form, "Want to read", "Title", "A title is needed.");
    await form.getByLabel("Title").fill("Kitchen Notes");
    await wrongAt(form, "Want to read", "Author", "An author is needed.");
    await form.getByLabel("Author", { exact: true }).fill("June Ash");
    await form.getByLabel("Cover image address").fill("example");
    await wrongAt(form, "Want to read", "Cover image address", COVER_ERROR);

    await form.getByLabel("Cover image address").fill("www.example.com/c.jpg");
    await form.getByRole("button", { name: "Want to read" }).click();
    await expect(addScreen(page).getByRole("region", { name: "Added so far" }).getByRole("listitem")).toContainText("Kitchen Notes");
  });

  test("Edit, for a Manual Book on its screen: its fields, a missing title, and the cover rule", async ({ page }) => {
    await manualBook("Kitchen Notes", "June Ash", "Recipes.");
    await page.goto("/");
    await page.getByRole("main").getByRole("button", { name: /^Kitchen Notes/ }).click();
    await page.getByRole("button", { name: "Edit details" }).click();
    const form = page.getByRole("form", { name: "Edit Kitchen Notes" });

    await expect(form.getByLabel("Title")).toBeFocused();
    await expect(form.getByLabel("Title")).not.toHaveAttribute("enterkeyhint");
    await expect(form.getByLabel("Author", { exact: true })).toHaveAccessibleDescription("Separate co-authors with ‘and’.");
    await expect(form.getByLabel("Description")).toHaveValue("Recipes.");

    await form.getByLabel("Title").fill("");
    await wrongAt(form, "Save changes", "Title", "A title is needed.");
    await form.getByLabel("Title").fill("Kitchen Notes");
    await form.getByLabel("Cover image address").fill("not a url");
    await wrongAt(form, "Save changes", "Cover image address", COVER_ERROR);
    await form.getByLabel("Cover image address").fill("www.example.com/c.jpg");
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(form).toHaveCount(0);
    // Edit opens on the Book as the page last had it, so it is opened again until the save's refresh lands.
    await expect(async () => {
      if (await form.count()) await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Edit details" }).click();
      await expect(form.getByLabel("Cover image address")).toHaveValue("https://www.example.com/c.jpg", { timeout: 1000 });
    }).toPass();
  });

  test("an edit that lands after leaving the Book's screen shows on the shelf", async ({ page }) => {
    await manualBook("Kitchen Notes", "June Ash", "Recipes.");
    await page.goto("/");
    await page.getByRole("main").getByRole("button", { name: /^Kitchen Notes/ }).click();
    await page.getByRole("button", { name: "Edit details" }).click();
    const form = page.getByRole("form", { name: "Edit Kitchen Notes" });
    await form.getByLabel("Title").fill("Kitchen Notes, Again");

    const call = await holdNextCall(page);
    await form.getByRole("button", { name: "Save changes" }).click();
    await call.held();
    await page.getByRole("button", { name: "Back to library" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("Reading");
    await call.release();
    await expect(page.getByRole("main").getByRole("button", { name: /^Kitchen Notes, Again/ })).toBeVisible();
  });
});
