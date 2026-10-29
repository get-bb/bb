// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("posthog-js");
  vi.unstubAllEnvs();
  history.replaceState(null, "", "/");
});

it("records one initial and one per public SPA route/back visit while excluding account routes", async () => {
  const capture = vi.fn();
  const init = vi.fn();
  vi.stubEnv("VITE_POSTHOG_KEY", "test-key");
  vi.doMock("posthog-js", () => ({ default: { init, capture } }));
  const analytics = await import("./analytics");
  analytics.initAnalytics();
  analytics.initAnalytics();
  await vi.waitFor(() => expect(init).toHaveBeenCalledTimes(1));
  analytics.trackMarketingPageview();
  expect(
    capture.mock.calls.filter(([event]) => event === "$pageview"),
  ).toHaveLength(1);
  expect(init.mock.calls[0]?.[1].capture_pageview).toBe(false);
  history.pushState(null, "", "/marketplace");
  analytics.initAnalytics();
  analytics.trackMarketingPageview();
  history.pushState(null, "", "/dashboard?token=private");
  analytics.trackMarketingPageview();
  history.replaceState(null, "", "/");
  analytics.trackMarketingPageview();
  expect(
    capture.mock.calls
      .filter(([event]) => event === "$pageview")
      .map(([, props]) => new URL(props.$current_url).pathname),
  ).toEqual(["/", "/marketplace", "/"]);
  expect(
    init.mock.calls[0]?.[1].before_send({ properties: {} }),
  ).not.toBeNull();
  history.pushState(null, "", "/oauth/authorize?code=private");
  expect(init.mock.calls[0]?.[1].before_send({ properties: {} })).toBeNull();
});

it("drops pre-initialization intent instead of replaying it on another page", async () => {
  const capture = vi.fn();
  let resolveSdk:
    | ((value: {
        default: { init: ReturnType<typeof vi.fn>; capture: typeof capture };
      }) => void)
    | undefined;
  vi.stubEnv("VITE_POSTHOG_KEY", "test-key");
  vi.doMock(
    "posthog-js",
    () =>
      new Promise((resolve) => {
        resolveSdk = resolve;
      }),
  );
  const analytics = await import("./analytics");
  analytics.initAnalytics();
  analytics.trackDownloadIntent({
    source_path: "/",
    page_family: "homepage",
    page_subtype: "homepage",
    placement: "hero",
    download_target: "macos",
    measurement_version: 1,
    intent_at: new Date().toISOString(),
    download_campaign: {},
  });
  history.pushState(null, "", "/marketplace");
  analytics.initAnalytics();
  await vi.waitFor(() => expect(resolveSdk).toBeDefined());
  resolveSdk?.({ default: { init: vi.fn(), capture } });
  await vi.waitFor(() => expect(capture).toHaveBeenCalled());
  expect(capture.mock.calls.map(([event]) => event)).toEqual(["$pageview"]);
});
