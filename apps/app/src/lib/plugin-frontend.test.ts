import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as react from "react";
import * as jsxRuntime from "react/jsx-runtime";
import clsx from "clsx";
import { Icon } from "@bb/shared-ui/icon";
import {
  createPluginFrontendPageLifecycle,
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
      jsBytes: 1_000,
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
      [
        candidate("stale", {
          compatible: false,
          sdkMajor: 9,
          sdkVersion: "9.2.0",
        }),
      ],
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
  interface RuntimeExports {
    classVarianceAuthority: object;
    clsx: { default: typeof clsx };
    jsxDevRuntime: object;
    jsxRuntime: { jsx: typeof jsxRuntime.jsx };
    pierreDiffs: object;
    pierreDiffsReact: object;
    pluginSdkApp: object;
    radixAlertDialog: object;
    radixContextMenu: object;
    radixDialog: object;
    radixDropdownMenu: object;
    radixHoverCard: object;
    radixMenubar: object;
    radixNavigationMenu: object;
    radixPopover: object;
    radixSelect: object;
    radixTooltip: object;
    react: { useState: typeof react.useState };
    reactDom: object;
    reactDomClient: object;
    sharedUiIcon: { Icon: typeof Icon };
    sonner: object;
    tailwindMerge: object;
    vaul: object;
  }

  type RuntimeHost = typeof globalThis & {
    __bbPluginRuntime?: RuntimeExports;
  };

  function runtimeHost(): RuntimeHost {
    return /* SAFETY: The runtime installer owns this global property and writes the declared runtime contract. */ globalThis as RuntimeHost;
  }

  beforeEach(() => {
    delete runtimeHost().__bbPluginRuntime;
  });

  afterEach(() => {
    delete runtimeHost().__bbPluginRuntime;
  });

  it("exposes the app's own runtime modules on every shim slot, exactly once", () => {
    installPluginRuntime();
    const runtime = runtimeHost().__bbPluginRuntime;
    if (runtime === undefined)
      throw new Error("plugin runtime was not installed");
    expect(Object.keys(runtime).sort()).toEqual([
      "classVarianceAuthority",
      "clsx",
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
      "sharedUiIcon",
      "sonner",
      "tailwindMerge",
      "vaul",
    ]);
    expect(runtime.clsx.default).toBe(clsx);
    expect(runtime.sharedUiIcon.Icon).toBe(Icon);
    expect(runtime.react.useState).toBe(react.useState);
    expect(runtime.jsxRuntime.jsx).toBe(jsxRuntime.jsx);
    expect(runtime.pluginSdkApp).toBe(pluginSdkAppImplementation);

    installPluginRuntime();
    expect(runtimeHost().__bbPluginRuntime).toBe(runtime);
  });

  it("hands plugins every @pierre/diffs/react export, with the diff components gated", async () => {
    installPluginRuntime();
    const runtime = runtimeHost().__bbPluginRuntime;
    if (runtime === undefined)
      throw new Error("plugin runtime was not installed");
    const pierreDiffsReact = await import("@pierre/diffs/react");
    const slot = runtime.pierreDiffsReact;
    expect(Object.keys(slot).sort()).toEqual(
      Object.keys(pierreDiffsReact).sort(),
    );
    const slotExport = (name: string) =>
      Object.getOwnPropertyDescriptor(slot, name)?.value;
    expect(slotExport("useVirtualizer")).toBe(pierreDiffsReact.useVirtualizer);
    expect(slotExport("WorkerPoolContext")).toBe(
      pierreDiffsReact.WorkerPoolContext,
    );
    expect(slotExport("FileDiff")).not.toBe(pierreDiffsReact.FileDiff);
    expect(slotExport("File")).not.toBe(pierreDiffsReact.File);
  });
});

describe("createPluginFrontendPageLifecycle", () => {
  function createDeps(tornDown: boolean) {
    return {
      isTornDown: vi.fn(() => tornDown),
      reboot: vi.fn(),
      reconcile: vi.fn(),
      teardown: vi.fn(),
    };
  }

  it("keeps frontends mounted when the page enters the back/forward cache", () => {
    const deps = createDeps(false);
    const lifecycle = createPluginFrontendPageLifecycle(deps);
    lifecycle.onPageHide({ persisted: true });
    expect(deps.teardown).not.toHaveBeenCalled();

    lifecycle.onPageShow({ persisted: true });
    expect(deps.reconcile).toHaveBeenCalledTimes(1);
    expect(deps.reboot).not.toHaveBeenCalled();
  });

  it("tears down on a real unload and reboots if a persisted restore follows a teardown", () => {
    const deps = createDeps(true);
    const lifecycle = createPluginFrontendPageLifecycle(deps);
    lifecycle.onPageHide({ persisted: false });
    expect(deps.teardown).toHaveBeenCalledTimes(1);

    lifecycle.onPageShow({ persisted: true });
    expect(deps.reboot).toHaveBeenCalledTimes(1);
    expect(deps.reconcile).not.toHaveBeenCalled();
  });

  it("ignores the initial (non-persisted) pageshow", () => {
    const deps = createDeps(false);
    createPluginFrontendPageLifecycle(deps).onPageShow({ persisted: false });
    expect(deps.reboot).not.toHaveBeenCalled();
    expect(deps.reconcile).not.toHaveBeenCalled();
  });
});
