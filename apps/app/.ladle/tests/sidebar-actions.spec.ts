import { expect, test, type Locator } from "@playwright/test";

async function bounds(locator: Locator) {
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  if (rect === null) throw new Error("Missing control bounds");
  return rect;
}

for (const width of [220, 288, 360]) {
  test(`parent and leaf actions keep their columns at ${width}px`, async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname.startsWith("/api/"),
      (route) => route.abort(),
    );
    await page.goto(
      "/?story=sidebar--thread-list--action-alignment&mode=preview&theme=light",
    );
    const panel = page.locator("[data-thread-row-fixture]");
    await expect(panel).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await panel.evaluate((element, value) => {
      element.style.width = `${value}px`;
    }, width);
    const rows = panel.locator('[data-sidebar-rename-row][role="button"]');
    const reference = rows.filter({
      has: page.locator('[data-sidebar-thread-id="thr_actions_leaf_short"]'),
    });
    await expect(rows).toHaveCount(8);
    await reference.hover();
    const referenceArchive = await bounds(
      reference.getByRole("button", { name: "Archive", exact: true }),
    );
    const referenceMenu = await bounds(
      reference.getByRole("button", { name: "Thread actions", exact: true }),
    );
    for (const row of await rows.all()) {
      await row.hover();
      const archive = row.getByRole("button", { name: "Archive", exact: true });
      const menu = row.getByRole("button", {
        name: "Thread actions",
        exact: true,
      });
      await expect(archive).toHaveCSS("pointer-events", "auto");
      await expect
        .poll(async () => (await bounds(archive)).x)
        .toBeCloseTo(referenceArchive.x, 1);
      const archiveRect = await bounds(archive);
      const menuRect = await bounds(menu);
      expect(menuRect.x).toBeCloseTo(referenceMenu.x, 1);
      expect(archiveRect.x + archiveRect.width).toBeLessThanOrEqual(menuRect.x);
      const arrow = row.getByRole("button", {
        name: /^(Expand|Collapse) .* threads$/,
      });
      if (await arrow.count()) {
        const arrowRect = await bounds(arrow);
        expect(arrowRect.x + arrowRect.width).toBeLessThanOrEqual(
          archiveRect.x,
        );
      }
    }
  });
}
