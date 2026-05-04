import { expect, test } from "@playwright/test";

test.describe("Fasskoll public smoke", () => {
  test("home loads and shows disclaimer", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Fasskoll" })).toBeVisible();
    await expect(page.getByText("inte en officiell tjänst från Fass", { exact: false })).toBeVisible();
    await expect(
      page.getByText(
        "Donationer är frivilliga och ger inga extra funktioner",
        { exact: false },
      ),
    ).toBeVisible();
  });

  test("public medicine flow returns data or controlled fallback", async ({ page }) => {
    await page.goto("/search?medicine=Estradot&zipCode=75318&autostart=1");

    await expect(page.getByRole("heading", { name: "Sök lagerstatus" })).toBeVisible();

    const resultsTable = page.locator("table tbody tr").first();
    const noResults = page.getByText("Inga träffar för vald sökning", { exact: false });
    const noFilterMatch = page.getByText("Inga apotek matchar valt filter", { exact: false });
    const degraded = page.getByText("Visar senast tillgängliga cachedata", { exact: false });
    const rateLimit = page.getByText("För många", { exact: false });

    await expect
      .poll(
        async () => {
          if (await resultsTable.isVisible()) return "results";
          if (await degraded.isVisible()) return "degraded";
          if (await noResults.isVisible()) return "no-results";
          if (await noFilterMatch.isVisible()) return "no-filter-match";
          if (await rateLimit.isVisible()) return "rate-limit";
          return "pending";
        },
        { timeout: 60_000 },
      )
      .not.toBe("pending");
  });
});
