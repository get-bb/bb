// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PLUGIN_CATALOG_CATEGORIES } from "@bb/domain";
import {
  CatalogEntryIcon,
  CatalogEntryIconChip,
  pluginCatalogCategoryIconName,
  pluginInstallCountPresentation,
} from "./plugin-ui";

afterEach(cleanup);

it("masks a tinted icon instead of embedding it as an image", () => {
  const iconUrl = "/api/v1/plugin-catalog/icons/bb-community/agent-proxy?h=ab";
  const view = render(
    <CatalogEntryIcon
      entry={{
        displayName: "Agent Proxy",
        icon: null,
        iconUrl,
        iconTinted: true,
      }}
      className="size-6"
    />,
  );

  expect(view.container.querySelector("img")).toBeNull();
  expect(
    view.container.querySelector(`[data-plugin-icon-asset="${iconUrl}"]`),
  ).toBeTruthy();
  expect(
    view.container
      .querySelector("[data-catalog-entry-icon-glyph]")
      ?.classList.contains("size-6"),
  ).toBe(true);
  expect(
    view.container
      .querySelector(`[data-plugin-icon-asset="${iconUrl}"]`)
      ?.classList.contains("size-full"),
  ).toBe(true);
});

it("embeds a marketplace listing's logo as an image", () => {
  const iconUrl = "/api/v1/plugin-catalog/icons/acme/widgets?h=cd";
  const view = render(
    <CatalogEntryIcon
      entry={{ displayName: "Widgets", icon: null, iconUrl, iconTinted: false }}
      className="size-6"
    />,
  );

  expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
    iconUrl,
  );
  expect(
    view.container.querySelector("img")?.classList.contains("size-full"),
  ).toBe(true);
});

it("uses one glyph box for host and marketplace catalog icons", () => {
  const view = render(
    <>
      <CatalogEntryIconChip
        entry={{
          displayName: "Push notifications",
          icon: "BellDot",
          iconUrl: null,
          iconTinted: false,
        }}
      />
      <CatalogEntryIconChip
        entry={{
          displayName: "Community notifications",
          icon: null,
          iconUrl: "/community-notifications.svg",
          iconTinted: false,
        }}
      />
    </>,
  );

  const glyphs = view.container.querySelectorAll(
    "[data-catalog-entry-icon-glyph]",
  );
  expect(glyphs).toHaveLength(2);
  for (const glyph of glyphs) {
    expect(glyph.classList.contains("size-6")).toBe(true);
    expect(glyph.parentElement?.classList.contains("size-10")).toBe(true);
    expect(glyph.firstElementChild?.classList.contains("size-full")).toBe(true);
  }
});

it("gives every built-in category its own icon and unknowns none", () => {
  const icons = PLUGIN_CATALOG_CATEGORIES.map((category) =>
    pluginCatalogCategoryIconName(category.id),
  );
  expect(icons).not.toContain(undefined);
  expect(new Set(icons).size).toBe(icons.length);
  expect(pluginCatalogCategoryIconName("future-category")).toBeUndefined();
});

it("labels built-in, new, and counted plugins", () => {
  const now = Date.parse("2026-10-02T00:00:00Z");
  const label = (entry: Parameters<typeof pluginInstallCountPresentation>[0]) =>
    pluginInstallCountPresentation(entry, now);
  expect(label({ installedByDefault: true, installs: 2 })?.display).toBe(
    "Built in",
  );
  expect(
    label({
      installedByDefault: false,
      installs: 3,
      publishedAt: "2026-09-20T00:00:00Z",
    })?.display,
  ).toBe("New");
  expect(
    label({ installedByDefault: false, installs: 1 })?.accessibleLabel,
  ).toBe("1 install");
  expect(label({ installedByDefault: false, installs: null })).toBeUndefined();
});
