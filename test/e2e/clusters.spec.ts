import { expect, test, type Page } from "@playwright/test";
import { addCluster, layOutGraph, nameCluster, seedLibrary, settleGraph } from "./database";

// Cluster washes, names and the Cluster panel, on the seeded chain. No worker runs, so a test stands in
// for the graph job: it writes the Clusters the job would, then settles it.

test.beforeEach(async () => {
  await seedLibrary();
});

const QUIET = { name: "Lives held in check", description: "Each follows a life spent keeping to a part." };
const name = (page: Page, text: string) => page.locator("[data-cluster-name]", { hasText: text });
const panel = (page: Page) => page.getByRole("complementary", { name: "Cluster" });

test("a Cluster's name opens its panel, and each of its Books opens that Book", async ({ page }) => {
  await addCluster(["Stoner", "The Remains of the Day", "Never Let Me Go"], QUIET);
  await page.goto("/graph");
  await name(page, QUIET.name).click();

  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(QUIET.name);
  await expect(panel(page).getByRole("heading", { level: 2 })).toBeFocused();
  await expect(panel(page).getByText(QUIET.description)).toBeVisible();
  await expect(panel(page).getByText("Cluster of 3 Books")).toBeVisible();
  const members = panel(page).getByRole("list", { name: "Books in this Cluster" }).getByRole("button");
  await expect(members).toHaveText(["Stoner", "The Remains of the Day", "Never Let Me Go"]);

  await members.filter({ hasText: "Never Let Me Go" }).click();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Never Let Me Go");
});

test("an unnamed Cluster shows as 'Cluster of N Books', and is reachable from the keyboard", async ({ page }) => {
  await addCluster(["Beloved", "The Plague", "Candide"], null);
  await page.goto("/graph");
  await expect(name(page, "Cluster of 3 Books")).toBeVisible();

  await page.getByRole("navigation", { name: "Clusters in the graph" }).getByRole("button", { name: "Cluster of 3 Books", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Cluster of 3 Books");
  await expect(panel(page).getByText("Not named yet.")).toBeVisible();
});

test("after a dismissal, the graph picks up the Clusters the graph job leaves, without a reload", async ({ page }) => {
  await page.goto("/graph");
  await page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button", { name: /^Stoner, / }).focus();
  await page.keyboard.press("Enter");
  const connections = page.getByRole("region", { name: "Connections" });
  await connections.getByRole("button", { name: "Dismiss" }).click();
  await connections.getByRole("button", { name: "Yes, dismiss" }).click();
  await expect(connections.getByText("No Connections yet.")).toBeVisible();
  // Back to the whole graph, where no panel covers a name.
  await page.keyboard.press("Escape");

  // The dismissal queued the graph job; the graph checks back until it settles.
  await addCluster(["Never Let Me Go", "Beloved", "The Plague"], QUIET);
  await expect(name(page, QUIET.name)).toBeHidden();
  await settleGraph();
  await expect(name(page, QUIET.name)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("navigation", { name: "Clusters in the graph" }).getByRole("button", { name: `${QUIET.name}, 3 Books` })).toBeAttached();
});

test("after a removal, a new Cluster shows unnamed while naming lags, then by its name", async ({ page }) => {
  await page.goto("/graph");
  await page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button", { name: /^Candide, / }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Remove from library" }).click();
  await page.getByRole("button", { name: "Yes, remove" }).click();
  await expect(page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button", { name: /^Candide, / })).toHaveCount(0);

  const id = await addCluster(["Stoner", "The Remains of the Day", "Never Let Me Go"], null);
  await layOutGraph();
  await expect(name(page, "Cluster of 3 Books")).toBeVisible({ timeout: 10_000 });
  await nameCluster(id, QUIET);
  await settleGraph();
  await expect(name(page, QUIET.name)).toBeVisible({ timeout: 10_000 });
});
