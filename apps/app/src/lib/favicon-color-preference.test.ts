// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppTheme, FAVICON_COLORS } from "@bb/domain";
import {
  applyInstallIconState,
  FAVICON_COLOR_SERVER_SYNCED_STORAGE_KEY,
  FAVICON_COLOR_STORAGE_KEY,
  getAppleTouchIconHref,
  getPwaManifestHref,
  useFaviconColorSync,
} from "./favicon-color-preference";

const mocks = vi.hoisted(() => ({
  updateAppearance: vi.fn(),
  useSystemConfig: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: mocks.useSystemConfig,
}));

vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateAppearance: () => ({
    mutate: mocks.updateAppearance,
  }),
}));

interface WebManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

interface WebManifest {
  icons: WebManifestIcon[];
}

const publicDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../public",
);

function setSystemFaviconColor(
  faviconColor: typeof defaultAppTheme.faviconColor,
): void {
  mocks.useSystemConfig.mockReturnValue({
    data: {
      appearance: {
        ...defaultAppTheme,
        faviconColor,
      },
    },
  });
}

function publicAssetPath(href: string): string {
  expect(href.startsWith("/")).toBe(true);
  return join(publicDir, href.slice(1));
}

function readManifest(href: string): WebManifest {
  return JSON.parse(readFileSync(publicAssetPath(href), "utf8"));
}

function expectLinkElement(element: HTMLElement | null): HTMLLinkElement {
  expect(element).toBeInstanceOf(HTMLLinkElement);
  if (!(element instanceof HTMLLinkElement)) {
    throw new Error("Expected link element");
  }
  return element;
}

describe("favicon color install icons", () => {
  afterEach(() => {
    document.head.replaceChildren();
    window.localStorage.clear();
    cleanup();
    vi.clearAllMocks();
  });

  it("maps the default install icon links to the shipped assets", () => {
    expect(getPwaManifestHref("default")).toBe("/manifest.webmanifest");
    expect(getAppleTouchIconHref("default")).toBe("/apple-touch-icon.png");
  });

  it("updates manifest and apple touch icon links from the color preference", () => {
    document.head.innerHTML = `
      <link rel="manifest" href="/manifest.webmanifest" id="app-manifest" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" id="apple-touch-icon" />
    `;

    applyInstallIconState("teal");

    const manifestLink = document.getElementById("app-manifest");
    const appleTouchIconLink = document.getElementById("apple-touch-icon");
    expect(new URL(expectLinkElement(manifestLink).href).pathname).toBe(
      "/manifest-teal.webmanifest",
    );
    expect(new URL(expectLinkElement(appleTouchIconLink).href).pathname).toBe(
      "/apple-touch-icon-teal.png",
    );
  });

  it("has manifest and icon assets for every selectable color", () => {
    for (const color of FAVICON_COLORS) {
      const manifestHref = getPwaManifestHref(color);
      const appleTouchIconHref = getAppleTouchIconHref(color);
      expect(existsSync(publicAssetPath(manifestHref))).toBe(true);
      expect(existsSync(publicAssetPath(appleTouchIconHref))).toBe(true);

      const manifest = readManifest(manifestHref);
      expect(manifest.icons).toEqual([
        {
          src: `/icon-192-${color}.png`,
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: `/icon-512-${color}.png`,
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: `/icon-192-maskable-${color}.png`,
          sizes: "192x192",
          type: "image/png",
          purpose: "maskable",
        },
        {
          src: `/icon-512-maskable-${color}.png`,
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ]);

      for (const icon of manifest.icons) {
        expect(existsSync(publicAssetPath(icon.src))).toBe(true);
      }
    }
  });
});

describe("favicon color server sync", () => {
  afterEach(() => {
    window.localStorage.clear();
    cleanup();
    vi.clearAllMocks();
  });

  it("migrates a cached legacy tint when the server has no stored tint yet", async () => {
    window.localStorage.setItem(FAVICON_COLOR_STORAGE_KEY, "teal");
    setSystemFaviconColor("default");
    mocks.updateAppearance.mockImplementation((_selection, options) => {
      options?.onSuccess?.();
    });

    renderHook(() => useFaviconColorSync());

    await waitFor(() =>
      expect(mocks.updateAppearance).toHaveBeenCalledWith(
        { themeId: "default", faviconColor: "teal" },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      ),
    );
    expect(window.localStorage.getItem(FAVICON_COLOR_STORAGE_KEY)).toBe("teal");
    expect(
      window.localStorage.getItem(FAVICON_COLOR_SERVER_SYNCED_STORAGE_KEY),
    ).toBe("true");
  });

  it("does not restore a cached tint after the server value has been seen", async () => {
    window.localStorage.setItem(FAVICON_COLOR_STORAGE_KEY, "teal");
    setSystemFaviconColor("teal");
    const { rerender } = renderHook(() => useFaviconColorSync());

    await waitFor(() =>
      expect(
        window.localStorage.getItem(FAVICON_COLOR_SERVER_SYNCED_STORAGE_KEY),
      ).toBe("true"),
    );

    mocks.updateAppearance.mockClear();
    setSystemFaviconColor("default");
    rerender();

    await waitFor(() =>
      expect(window.localStorage.getItem(FAVICON_COLOR_STORAGE_KEY)).toBeNull(),
    );
    expect(mocks.updateAppearance).not.toHaveBeenCalled();
  });
});
