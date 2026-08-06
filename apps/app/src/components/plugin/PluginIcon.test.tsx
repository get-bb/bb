// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";

const { PluginIcon } = await import("./PluginIcon");

afterEach(() => {
  cleanup();
  resetPluginLogoStoreForTest();
});

it("uses branding.icon instead of the image logo or contribution hint", () => {
  setPluginLogoUrls(
    new Map([
      [
        "docs",
        {
          displayName: "Docs",
          icon: "FileText",
          compactIconUrl: null,
          logoUrl: "/api/v1/plugins/docs/assets/logo?h=abc",
          logoDarkUrl: "/api/v1/plugins/docs/assets/logo-dark?h=def",
        },
      ],
    ]),
  );

  const view = render(<PluginIcon pluginId="docs" icon="Layers" />);
  expect(view.container.querySelector("[data-icon=FileText]")).toBeTruthy();
  expect(view.container.querySelector("[data-icon=Layers]")).toBeNull();
  expect(view.container.querySelector("img")).toBeNull();
});

it("uses the contribution hint when branding.icon is omitted", () => {
  setPluginLogoUrls(
    new Map([
      [
        "github",
        {
          displayName: "GitHub",
          icon: null,
          compactIconUrl: null,
          logoUrl: "/api/v1/plugins/github/assets/logo?h=abc",
          logoDarkUrl: null,
        },
      ],
    ]),
  );

  const view = render(<PluginIcon pluginId="github" icon="Layers" />);
  expect(view.container.querySelector("[data-icon=Layers]")).toBeTruthy();
  expect(view.container.querySelector("img")).toBeNull();
});

it("can prefer a contribution hint over branding.icon", () => {
  setPluginLogoUrls(
    new Map([
      [
        "tasks",
        {
          displayName: "Tasks",
          icon: "ListTodo",
          compactIconUrl: null,
          logoUrl: null,
          logoDarkUrl: null,
        },
      ],
    ]),
  );

  const view = render(
    <PluginIcon pluginId="tasks" icon="Home" preferContributionIcon />,
  );
  expect(view.container.querySelector("[data-icon=Home]")).toBeTruthy();
  expect(view.container.querySelector("[data-icon=ListTodo]")).toBeNull();
});

it("uses Zap compactly when a logo-only plugin has no contribution hint", () => {
  setPluginLogoUrls(
    new Map([
      [
        "github",
        {
          displayName: "GitHub",
          icon: null,
          compactIconUrl: null,
          logoUrl: "/api/v1/plugins/github/assets/logo?h=abc",
          logoDarkUrl: null,
        },
      ],
    ]),
  );

  const view = render(<PluginIcon pluginId="github" icon={null} />);
  expect(view.container.querySelector("[data-icon=Zap]")).toBeTruthy();
  expect(view.container.querySelector("img")).toBeNull();
});

it("uses a plugin-owned compact SVG before named icon hints", () => {
  const compactIconUrl = "/api/v1/plugins/omega/assets/icon?h=abc";
  setPluginLogoUrls(
    new Map([
      [
        "omega",
        {
          displayName: "Omegacode",
          icon: "Workflow",
          compactIconUrl,
          logoUrl: null,
          logoDarkUrl: null,
        },
      ],
    ]),
  );

  const view = render(<PluginIcon pluginId="omega" icon="Layers" />);
  const asset = view.container.querySelector(
    `[data-plugin-icon-asset="${compactIconUrl}"]`,
  );
  expect(asset).toBeTruthy();
  expect(asset?.getAttribute("style")).toContain(compactIconUrl);
  expect(view.container.querySelector("[data-icon]")).toBeNull();
});
