import { getAppSettings, setAppSettings } from "@bb/db";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { signInBrowserContext, summarize } from "./render-session.js";
import { useRenderFixture } from "./test-fixture.js";

const IDLE_MS = 10_000;
const ONBOARDING_TIMEOUT_MS = 30_000;
const PLUGIN_BUNDLE_URL = /\/plugin-app-assets\/[^/]+\/app\.js$/u;

const pluginListSchema = z.object({
  plugins: z.array(
    z.object({
      enabled: z.boolean(),
      status: z.string(),
      app: z.object({
        bundle: z
          .object({ jsUrl: z.string(), compatible: z.boolean() })
          .nullable(),
      }),
    }),
  ),
});

describe("render invariants", () => {
  const context = useRenderFixture();
  const { inThread } = context;

  it("first-run onboarding loads every plugin, not only the ones its screen needs", async () => {
    const { serverUrl, harness } = context.fixture;
    const settings = getAppSettings(harness.db);
    setAppSettings(harness.db, { ...settings, onboardingCompletedAt: null });
    const browserContext = await context.browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    try {
      const { localAuthorization } = harness.server;
      await signInBrowserContext(browserContext, serverUrl, localAuthorization);
      const response = await fetch(`${serverUrl}/api/v1/plugins`, {
        headers: { authorization: localAuthorization },
      });
      const { plugins } = pluginListSchema.parse(await response.json());
      const expected = plugins
        .flatMap((plugin) =>
          plugin.enabled &&
          plugin.status === "running" &&
          plugin.app.bundle?.compatible === true
            ? [new URL(plugin.app.bundle.jsUrl, serverUrl).pathname]
            : [],
        )
        .sort();
      expect(expected.length).toBeGreaterThan(0);
      const page = await browserContext.newPage();
      const requested = new Set<string>();
      page.on("request", (request) => {
        const { pathname } = new URL(request.url());
        if (PLUGIN_BUNDLE_URL.test(pathname)) requested.add(pathname);
      });
      await page.goto(serverUrl);
      await page.waitForSelector('[data-testid="onboarding"]', {
        timeout: ONBOARDING_TIMEOUT_MS,
      });
      await expect
        .poll(() => [...requested].sort(), { timeout: 15_000 })
        .toEqual(expected);
    } finally {
      await browserContext.close();
      setAppSettings(harness.db, settings);
    }
  });

  it("renders nothing while the app sits idle for 10 s", async () => {
    await inThread(context.fixture.timelineThreadId, async (session) => {
      await session.reset();
      await session.page.waitForTimeout(IDLE_MS);
      const report = await session.report();
      expect(summarize(report.renders)).toEqual([]);
    });
  });
});
