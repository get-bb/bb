import type { Page } from "playwright-core";
import { describe, expect, it } from "vitest";
import { useRenderFixture } from "./test-fixture.js";

const ROOT_FONT_SIZES = [16, 20, 32];
const IOS_TEXT_SCALES = [1, 3.571];

async function setIosTextScale(page: Page, scale: number): Promise<void> {
  await page.evaluate((factor) => {
    const root = document.documentElement;
    root.style.setProperty("--bb-ios-font-scale", String(factor));
    root.style.setProperty("--bb-ios-text-size-adjust", `${factor * 100}%`);
    if (factor === 1) {
      delete root.dataset.bbIosTextScale;
    } else {
      root.dataset.bbIosTextScale = String(factor);
    }
  }, scale);
}

describe("composer and recents text sizing", () => {
  const context = useRenderFixture();

  it("fits two-line recent rows at larger browser and iOS text sizes", async () => {
    const page = await context.browser.newPage({
      viewport: { width: 390, height: 900 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      const cdp = await page.context().newCDPSession(page);
      await page.goto(context.fixture.serverUrl);
      const firstRow = page
        .locator("[data-root-compose-mobile-recents] li")
        .first();
      await firstRow.waitFor();

      for (const rootFontSize of ROOT_FONT_SIZES) {
        await cdp.send("Page.setFontSizes", {
          fontSizes: { standard: rootFontSize },
        });
        for (const scale of IOS_TEXT_SCALES) {
          await setIosTextScale(page, scale);
          const geometry = await firstRow.evaluate((row) => {
            const label = row.querySelector("a > span");
            if (!label) throw new Error("Missing recent thread label");
            return {
              rowHeight: row.getBoundingClientRect().height,
              labelHeight: label.getBoundingClientRect().height,
            };
          });
          expect(geometry.rowHeight).toBeCloseTo(
            rootFontSize * 3.75 * scale,
            1,
          );
          expect(geometry.rowHeight).toBeGreaterThanOrEqual(
            geometry.labelHeight,
          );
        }
      }
    } finally {
      await page.close();
    }
  });

  it("fits the collapsed editor at larger browser and iOS text sizes", async () => {
    const page = await context.browser.newPage({
      viewport: { width: 600, height: 900 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      const cdp = await page.context().newCDPSession(page);
      await page.goto(
        `${context.fixture.serverUrl}/threads/${context.fixture.timelineThreadId}`,
      );
      const editor = page.locator(
        "[data-promptbox-compact] [data-promptbox-editor-scroll]",
      );
      await editor.waitFor();

      for (const rootFontSize of ROOT_FONT_SIZES) {
        await cdp.send("Page.setFontSizes", {
          fontSizes: { standard: rootFontSize },
        });
        for (const scale of IOS_TEXT_SCALES) {
          await setIosTextScale(page, scale);
          const geometry = await editor.evaluate((scroll) => {
            const main = scroll.closest("[data-promptbox-main]");
            const prose = scroll.querySelector(".ProseMirror");
            if (!main || !prose)
              throw new Error("Missing compact editor content");
            return {
              mainHeight: main.getBoundingClientRect().height,
              scrollHeight: scroll.getBoundingClientRect().height,
              lineHeight: Number.parseFloat(getComputedStyle(prose).lineHeight),
            };
          });
          const expectedHeight =
            scale === 1 ? rootFontSize * 3 : rootFontSize * 1.7 * scale;
          expect(geometry.scrollHeight).toBeCloseTo(expectedHeight, 1);
          expect(geometry.mainHeight).toBeCloseTo(expectedHeight, 1);
          expect(geometry.scrollHeight + 0.02).toBeGreaterThanOrEqual(
            geometry.lineHeight,
          );
        }
      }
    } finally {
      await page.close();
    }
  });
});
