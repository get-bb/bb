// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";

vi.mock("@/hooks/useTheme", () => ({
  usePreferredTheme: () => "light",
}));

const { PluginIcon } = await import("./PluginIcon");

afterEach(() => {
  cleanup();
  resetPluginLogoStoreForTest();
});

it("uses the plugin's canonical app icon on surfaces without an icon hint", () => {
  setPluginLogoUrls(
    new Map([
      [
        "docs",
        {
          icon: "FileText",
          logoUrl: null,
          logoDarkUrl: null,
        },
      ],
    ]),
  );

  const view = render(<PluginIcon pluginId="docs" icon={null} />);
  expect(view.container.querySelector("[data-icon=FileText]")).toBeTruthy();
  expect(view.container.querySelector("[data-icon=Zap]")).toBeNull();
});

it("falls back to the canonical app icon when the plugin logo fails", () => {
  setPluginLogoUrls(
    new Map([
      [
        "github",
        {
          icon: "Github",
          logoUrl: "/api/v1/plugins/github/assets/logo?h=abc",
          logoDarkUrl: null,
        },
      ],
    ]),
  );

  const view = render(<PluginIcon pluginId="github" icon="Layers" />);
  const logo = view.getByTestId("plugin-logo-github");
  fireEvent.error(logo);

  expect(view.container.querySelector("[data-icon=Github]")).toBeTruthy();
  expect(view.container.querySelector("[data-icon=Layers]")).toBeNull();
});
