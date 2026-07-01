// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { FAVICON_COLORS } from "@bb/domain";
import {
  applyInstallIconState,
  getAppleTouchIconHref,
  getPwaManifestHref,
} from "./favicon-color-preference";

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
