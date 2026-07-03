// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setPreferredTheme } from "@/hooks/useTheme";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";
import { PluginIcon } from "./PluginIcon";

const LIGHT_URL = "/api/v1/plugins/linear/assets/logo?h=aaaa000000000000";
const DARK_URL = "/api/v1/plugins/linear/assets/logo-dark?h=bbbb000000000000";

function setLogos(logoUrl: string | null, logoDarkUrl: string | null) {
  setPluginLogoUrls(new Map([["linear", { logoUrl, logoDarkUrl }]]));
}

afterEach(() => {
  cleanup();
  resetPluginLogoStoreForTest();
  // The theme store is module-level; leave it light for the next test file.
  act(() => setPreferredTheme("light"));
});

describe("PluginIcon theme-aware logo", () => {
  it("renders the light logo in light mode even when a dark variant exists", () => {
    act(() => setPreferredTheme("light"));
    setLogos(LIGHT_URL, DARK_URL);
    render(<PluginIcon pluginId="linear" icon={null} />);
    expect(screen.getByTestId("plugin-logo-linear").getAttribute("src")).toBe(
      LIGHT_URL,
    );
  });

  it("renders the dark variant in dark mode", () => {
    act(() => setPreferredTheme("dark"));
    setLogos(LIGHT_URL, DARK_URL);
    render(<PluginIcon pluginId="linear" icon={null} />);
    expect(screen.getByTestId("plugin-logo-linear").getAttribute("src")).toBe(
      DARK_URL,
    );
  });

  it("falls back to the light logo in dark mode when no dark variant exists", () => {
    act(() => setPreferredTheme("dark"));
    setLogos(LIGHT_URL, null);
    render(<PluginIcon pluginId="linear" icon={null} />);
    expect(screen.getByTestId("plugin-logo-linear").getAttribute("src")).toBe(
      LIGHT_URL,
    );
  });

  it("re-renders onto the other variant when the theme flips", () => {
    act(() => setPreferredTheme("light"));
    setLogos(LIGHT_URL, DARK_URL);
    render(<PluginIcon pluginId="linear" icon={null} />);
    expect(screen.getByTestId("plugin-logo-linear").getAttribute("src")).toBe(
      LIGHT_URL,
    );
    act(() => setPreferredTheme("dark"));
    expect(screen.getByTestId("plugin-logo-linear").getAttribute("src")).toBe(
      DARK_URL,
    );
  });

  it("renders the named-icon fallback when the plugin ships no logo", () => {
    render(<PluginIcon pluginId="linear" icon={null} />);
    expect(screen.queryByTestId("plugin-logo-linear")).toBeNull();
  });
});
