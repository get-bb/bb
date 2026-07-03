import { afterEach, describe, expect, it, vi } from "vitest";
import * as react from "react";
import * as jsxRuntime from "react/jsx-runtime";
import {
  installPluginRuntime,
  loadPluginFrontends,
  type PluginFrontendCandidate,
} from "./plugin-frontend";
import { pluginSdkAppImplementation } from "./plugin-sdk-app-impl";

function candidate(
  pluginId: string,
  overrides: Partial<PluginFrontendCandidate["bundle"]> = {},
): PluginFrontendCandidate {
  return {
    pluginId,
    bundle: {
      jsUrl: `/api/v1/plugins/${pluginId}/assets/app.js?h=abc123`,
      cssUrl: `/api/v1/plugins/${pluginId}/assets/app.css?h=abc123`,
      hash: "abc123",
      sdkMajor: 0,
      sdkVersion: "0.1.0",
      compatible: true,
      ...overrides,
    },
  };
}

describe("loadPluginFrontends", () => {
  it("imports each compatible bundle, links its CSS, and keeps the module namespace", async () => {
    const moduleA = { default: { kind: "plugin-app" } };
    const moduleB = { default: { kind: "other-app" } };
    const importModule = vi
      .fn()
      .mockImplementation(async (url: string) =>
        url.includes("/plugins/a/") ? moduleA : moduleB,
      );
    const injectCss = vi.fn();

    const records = await loadPluginFrontends(
      [candidate("a"), candidate("b", { cssUrl: null })],
      { importModule, injectCss, warn: vi.fn() },
    );

    expect(records.get("a")).toEqual({
      pluginId: "a",
      status: "loaded",
      module: moduleA,
    });
    expect(records.get("b")).toEqual({
      pluginId: "b",
      status: "loaded",
      module: moduleB,
    });
    expect(importModule).toHaveBeenCalledWith(
      "/api/v1/plugins/a/assets/app.js?h=abc123",
    );
    // CSS only for the plugin that has one.
    expect(injectCss).toHaveBeenCalledTimes(1);
    expect(injectCss).toHaveBeenCalledWith(
      "a",
      "/api/v1/plugins/a/assets/app.css?h=abc123",
    );
  });

  it("contains an import failure to its own plugin", async () => {
    const good = { default: {} };
    const importModule = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/plugins/broken/")) {
        throw new Error("SyntaxError: unexpected token");
      }
      return good;
    });
    const warn = vi.fn();

    const records = await loadPluginFrontends(
      [candidate("broken"), candidate("fine", { cssUrl: null })],
      { importModule, injectCss: vi.fn(), warn },
    );

    expect(records.get("broken")).toEqual({
      pluginId: "broken",
      status: "failed",
      error: "SyntaxError: unexpected token",
    });
    expect(records.get("fine")).toEqual({
      pluginId: "fine",
      status: "loaded",
      module: good,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[plugin:broken] frontend bundle failed to load"),
    );
  });

  it("records a bundle that evaluates to a non-module as failed", async () => {
    const records = await loadPluginFrontends(
      [candidate("odd", { cssUrl: null })],
      {
        importModule: async () => undefined,
        injectCss: vi.fn(),
        warn: vi.fn(),
      },
    );
    expect(records.get("odd")).toMatchObject({
      status: "failed",
      error: expect.stringContaining("module namespace"),
    });
  });

  it("skips incompatible bundles with a needs-update record and a warning", async () => {
    const importModule = vi.fn();
    const warn = vi.fn();

    const records = await loadPluginFrontends(
      [candidate("stale", { compatible: false, sdkMajor: 9, sdkVersion: "9.2.0" })],
      { importModule, injectCss: vi.fn(), warn },
    );

    expect(records.get("stale")).toEqual({
      pluginId: "stale",
      status: "needs-update",
      sdkMajor: 9,
      sdkVersion: "9.2.0",
    });
    expect(importModule).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[plugin:stale]"),
    );
  });
});

describe("installPluginRuntime", () => {
  type RuntimeHost = typeof globalThis & { __bbPluginRuntime?: unknown };

  afterEach(() => {
    delete (globalThis as RuntimeHost).__bbPluginRuntime;
  });

  it("exposes the app's own runtime modules on every shim slot, exactly once", () => {
    installPluginRuntime();
    const runtime = (globalThis as RuntimeHost).__bbPluginRuntime as Record<
      string,
      unknown
    >;
    // The shim slot names `bb plugin build` emits (react ×5 + SDK + the
    // shared-singleton packages: portal radix families, sonner, vaul,
    // @pierre/diffs).
    expect(Object.keys(runtime).sort()).toEqual([
      "jsxDevRuntime",
      "jsxRuntime",
      "pierreDiffs",
      "pierreDiffsReact",
      "pluginSdkApp",
      "radixAlertDialog",
      "radixContextMenu",
      "radixDialog",
      "radixDropdownMenu",
      "radixHoverCard",
      "radixMenubar",
      "radixNavigationMenu",
      "radixPopover",
      "radixSelect",
      "radixTooltip",
      "react",
      "reactDom",
      "reactDomClient",
      "sonner",
      "vaul",
    ]);
    // Identity matters: plugins must get the app's own React, not a copy.
    expect((runtime.react as { useState: unknown }).useState).toBe(
      react.useState,
    );
    expect((runtime.jsxRuntime as { jsx: unknown }).jsx).toBe(jsxRuntime.jsx);
    // The SDK slot carries the real implementation surface (kept in sync
    // with the facade's export names by plugin-sdk-app-impl.test.ts).
    expect(runtime.pluginSdkApp).toBe(pluginSdkAppImplementation);

    // A second call never replaces an installed runtime.
    installPluginRuntime();
    expect((globalThis as RuntimeHost).__bbPluginRuntime).toBe(runtime);
  });
});
