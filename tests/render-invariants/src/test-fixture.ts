import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll } from "vitest";
import { startRenderFixture, type RenderFixture } from "./fixture.js";
import { openThread, type RenderSession } from "./render-session.js";

export function useRenderFixture() {
  let fixture: RenderFixture;
  let browser: Browser;

  beforeAll(async () => {
    fixture = await startRenderFixture();
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    try {
      await browser?.close();
    } finally {
      await fixture?.cleanup();
    }
  });

  return {
    get fixture() {
      return fixture;
    },
    get browser() {
      return browser;
    },
    async inThread(
      threadId: string,
      run: (session: RenderSession) => Promise<void>,
    ): Promise<void> {
      const session = await openThread(browser, fixture.serverUrl, threadId);
      try {
        await run(session);
      } finally {
        await session.close();
      }
    },
  };
}
