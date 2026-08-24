// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CatalogEntryIcon } from "./plugin-ui";

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

  // An <img> resolves the SVG's currentColor against the image document, so
  // the mark would paint black on a dark surface.
  expect(view.container.querySelector("img")).toBeNull();
  expect(
    view.container.querySelector(`[data-plugin-icon-asset="${iconUrl}"]`),
  ).toBeTruthy();
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
});
