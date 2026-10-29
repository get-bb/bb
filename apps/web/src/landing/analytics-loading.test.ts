// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import { initAnalytics, trackDownloadIntent } from "./analytics";

const sdk = vi.hoisted(() => {
  let release = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release, init: vi.fn(), capture: vi.fn() };
});

vi.mock("posthog-js", async () => {
  await sdk.ready;
  return { default: { init: sdk.init, capture: sdk.capture } };
});

afterEach(() => {
  sdk.release();
  vi.unstubAllEnvs();
  history.replaceState(null, "", "/");
});

it("drops pre-initialization intent instead of replaying it on another page", async () => {
  vi.stubEnv("VITE_POSTHOG_KEY", "test-key");
  initAnalytics();
  trackDownloadIntent({
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
  initAnalytics();
  expect(sdk.capture).not.toHaveBeenCalled();
  sdk.release();
  await vi.waitFor(() => expect(sdk.capture).toHaveBeenCalled());
  expect(sdk.capture.mock.calls.map(([event]) => event)).toEqual(["$pageview"]);
  expect(new URL(sdk.capture.mock.calls[0]?.[1].$current_url).pathname).toBe(
    "/marketplace",
  );
});
