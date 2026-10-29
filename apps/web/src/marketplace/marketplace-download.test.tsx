// @vitest-environment jsdom

import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MARKETPLACE_V2_FIXTURE } from "./marketplace-v2.fixture.js";
import { PublicMarketplaceDetailPage } from "./public-marketplace.js";

let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubEnv("VITE_POSTHOG_KEY", "");
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("marketplace download destination", () => {
  it.each([
    ["MacIntel", "Macintosh", "macos", "macOS"],
    ["Win32", "Windows NT 10.0", "windows", "Windows (Alpha)"],
    ["Linux x86_64", "X11; Linux x86_64", "linux", "Linux (Alpha)"],
  ])(
    "hydrates the plugin action for %s without changing the install command",
    async (platform, userAgent, target, label) => {
      vi.stubGlobal("navigator", { platform, userAgent });
      const page = (
        <PublicMarketplaceDetailPage
          manifest={MARKETPLACE_V2_FIXTURE}
          entry={MARKETPLACE_V2_FIXTURE.plugins[0]!}
          stats={null}
        />
      );
      const container = document.createElement("div");
      container.innerHTML = renderToString(page);
      document.body.appendChild(container);
      const download = () =>
        container.querySelector<HTMLAnchorElement>(
          ".marketplace-detail-download",
        );
      expect(download()?.getAttribute("href")).toBe(
        "/download/macos?placement=local",
      );
      const onRecoverableError = vi.fn();
      await act(async () => {
        root = hydrateRoot(container, page, { onRecoverableError });
      });
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(download()?.getAttribute("href")).toBe(
        `/download/${target}?placement=local`,
      );
      expect(download()?.textContent).toBe(`Get it for ${label}`);
      expect(
        container.querySelector(
          '[aria-label="Copy bb plugin install prompt-library"]',
        ),
      ).not.toBeNull();
    },
  );
});
