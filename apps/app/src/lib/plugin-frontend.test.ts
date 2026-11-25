import { afterEach, describe, expect, it, vi } from "vitest";
import * as react from "react";
import * as jsxRuntime from "react/jsx-runtime";
import clsx from "clsx";
import { Icon } from "@bb/shared-ui/icon";
import {
  HOST_LOADED_RUNTIME_SLOTS,
  RUNTIME_SLOT_BY_SPECIFIER,
} from "@bb/plugin-build/runtime-shims";
import {
  createPluginFrontendPageLifecycle,
  installPluginRuntime,
  loadPluginFrontend,
  type PluginFrontendCandidate,
} from "./plugin-frontend";
import {
  pluginSdkAppImplementation,
  retiredPluginSdkAppMembers,
} from "./plugin-sdk-app-impl";
import { settleLazyModules } from "@/test/lazy-modules";
import { pluginRuntimeGroupsFor } from "./plugin-runtime-groups";

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
      runtimeSlots: [],
      staticChunkUrls: [],
      lazyChunkUrls: [],
      lazyRuntimeSlots: [],
      ...overrides,
    },
  };
}

describe("loadPluginFrontend", () => {
  it("contains an import failure to its own plugin", async () => {
    const good = { default: {} };
    const importModule = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/plugins/broken/")) {
        throw new Error("SyntaxError: unexpected token");
      }
      return good;
    });
    const warn = vi.fn();

    const deps = { importModule, prefetchModule: vi.fn(), warn };

    expect(await loadPluginFrontend(candidate("broken"), deps)).toEqual({
      pluginId: "broken",
      status: "failed",
      error: "SyntaxError: unexpected token",
    });
    expect(
      await loadPluginFrontend(candidate("fine", { cssUrl: null }), deps),
    ).toEqual({
      pluginId: "fine",
      status: "loaded",
      module: good,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[plugin:broken] frontend bundle failed to load"),
    );
  });

  it("records a bundle that evaluates to a non-module as failed", async () => {
    const record = await loadPluginFrontend(
      candidate("odd", { cssUrl: null }),
      {
        importModule: async () => undefined,
        prefetchModule: vi.fn(),
        warn: vi.fn(),
      },
    );
    expect(record).toMatchObject({
      status: "failed",
      error: expect.stringContaining("module namespace"),
    });
  });

  it("skips incompatible bundles with a needs-update record and a warning", async () => {
    const importModule = vi.fn();
    const warn = vi.fn();

    const record = await loadPluginFrontend(
      candidate("stale", {
        compatible: false,
        sdkMajor: 9,
        sdkVersion: "9.2.0",
      }),
      { importModule, prefetchModule: vi.fn(), warn },
    );

    expect(record).toEqual({
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

  it("exposes the app's eager runtime modules, exactly once", () => {
    installPluginRuntime();
    const runtime = (globalThis as RuntimeHost).__bbPluginRuntime as Record<
      string,
      unknown
    >;
    expect(Object.keys(runtime).sort()).toEqual(
      [
        ...[...new Set(Object.values(RUNTIME_SLOT_BY_SPECIFIER))].filter(
          (slot) => !HOST_LOADED_RUNTIME_SLOTS.includes(slot),
        ),
        "loadRuntimeSlot",
      ].sort(),
    );
    expect((runtime.clsx as { default: unknown }).default).toBe(clsx);
    expect((runtime.sharedUiIcon as { Icon: unknown }).Icon).toBe(Icon);
    expect((runtime.react as { useState: unknown }).useState).toBe(
      react.useState,
    );
    expect((runtime.jsxRuntime as { jsx: unknown }).jsx).toBe(jsxRuntime.jsx);
    expect(runtime.pluginSdkApp).toEqual({
      ...pluginSdkAppImplementation,
      experimental_useSidebarThreadPullRequest:
        retiredPluginSdkAppMembers.experimental_useSidebarThreadPullRequest,
    });

    installPluginRuntime();
    expect((globalThis as RuntimeHost).__bbPluginRuntime).toBe(runtime);
  });

  it("provides @pierre/diffs only to bundles that import it, downloading the bundle meanwhile", async () => {
    const pierreSlots = () =>
      Object.keys(
        (globalThis as RuntimeHost).__bbPluginRuntime as Record<
          string,
          unknown
        >,
      ).filter((slot) => slot.startsWith("pierre"));
    const slotsAtImport: string[][] = [];
    const importModule = vi.fn(async () => {
      slotsAtImport.push(pierreSlots());
      return { default: {} };
    });
    installPluginRuntime();

    const prefetchModule = vi.fn((url: string) =>
      slotsAtImport.push([`prefetch ${url.split("/")[4]}`, ...pierreSlots()]),
    );
    await loadPluginFrontend(candidate("plain", { runtimeSlots: ["react"] }), {
      importModule,
      prefetchModule,
      warn: vi.fn(),
    });
    await settleLazyModules(
      loadPluginFrontend(
        candidate("differ", { runtimeSlots: ["pierreDiffsReact", "react"] }),
        { importModule, prefetchModule, warn: vi.fn() },
      ),
    );

    expect(slotsAtImport).toEqual([
      [],
      ["prefetch differ"],
      ["pierreDiffs", "pierreDiffsReact"],
    ]);
    const runtime = (globalThis as RuntimeHost).__bbPluginRuntime as Record<
      string,
      unknown
    >;
    const pierreDiffs = await import("@pierre/diffs");
    const pierreDiffsReact = await import("@pierre/diffs/react");
    expect(runtime.pierreDiffs).toBe(pierreDiffs);
    const slot = runtime.pierreDiffsReact as Record<string, unknown>;
    expect(Object.keys(slot).sort()).toEqual(
      Object.keys(pierreDiffsReact).sort(),
    );
    expect(slot.useVirtualizer).toBe(pierreDiffsReact.useVirtualizer);
    expect(slot.WorkerPoolContext).toBe(pierreDiffsReact.WorkerPoolContext);
    expect(slot.FileDiff).not.toBe(pierreDiffsReact.FileDiff);
    expect(slot.File).not.toBe(pierreDiffsReact.File);
  });
});

describe("split plugin bundles", () => {
  it("preloads the entry's static chunks with it and keeps lazy chunks off the load path", async () => {
    const shared = "/api/v1/plugin-app-assets/0123456789abcdef/chunks/chunk-A.js";
    const lazySurface =
      "/api/v1/plugin-app-assets/0123456789abcdef/chunks/DiffTab-B.js";
    const events: string[] = [];
    const prefetchModule = vi.fn((url: string) => events.push(`prefetch ${url}`));
    const importModule = vi.fn(async (url: string) => {
      events.push(`import ${url}`);
      return { default: {} };
    });

    const record = await loadPluginFrontend(
      candidate("split", {
        jsUrl: "/api/v1/plugin-app-assets/0123456789abcdef/app.js",
        staticChunkUrls: [shared],
        lazyChunkUrls: [lazySurface],
        lazyRuntimeSlots: ["pierreDiffs"],
      }),
      { importModule, prefetchModule, warn: vi.fn() },
    );

    expect(record.status).toBe("loaded");
    expect(events).toEqual([
      `prefetch ${shared}`,
      "import /api/v1/plugin-app-assets/0123456789abcdef/app.js",
    ]);
  });

  it("has a host loader for every slot the build loads on demand", () => {
    for (const slot of HOST_LOADED_RUNTIME_SLOTS) {
      expect(pluginRuntimeGroupsFor([slot]), slot).toHaveLength(1);
    }
  });

  it("gives a chunk's shim the host slot it needs when the chunk first loads", async () => {
    const runtime = installPluginRuntime() as unknown as Record<string, unknown>;
    const saved = { pierreDiffs: runtime.pierreDiffs, pierreDiffsReact: runtime.pierreDiffsReact };
    delete runtime.pierreDiffs;
    delete runtime.pierreDiffsReact;
    try {
      await settleLazyModules(installPluginRuntime().loadRuntimeSlot("pierreDiffs"));
      expect(runtime.pierreDiffs).toBe(await import("@pierre/diffs"));
      expect(runtime.pierreDiffsReact).toBeDefined();
    } finally {
      Object.assign(runtime, saved);
    }
  });
});

describe("createPluginFrontendPageLifecycle", () => {
  function createDeps() {
    return {
      restore: vi.fn(),
      discard: vi.fn(),
    };
  }

  it("keeps frontends mounted when the page enters the back/forward cache", () => {
    const deps = createDeps();
    const lifecycle = createPluginFrontendPageLifecycle(deps);
    lifecycle.onPageHide({ persisted: true });
    expect(deps.discard).not.toHaveBeenCalled();

    lifecycle.onPageShow({ persisted: true });
    expect(deps.restore).toHaveBeenCalledTimes(1);
  });

  it("discards frontends when the page unloads without entering the cache", () => {
    const deps = createDeps();
    createPluginFrontendPageLifecycle(deps).onPageHide({ persisted: false });
    expect(deps.discard).toHaveBeenCalledTimes(1);
    expect(deps.restore).not.toHaveBeenCalled();
  });

  it("ignores the initial (non-persisted) pageshow", () => {
    const deps = createDeps();
    createPluginFrontendPageLifecycle(deps).onPageShow({ persisted: false });
    expect(deps.restore).not.toHaveBeenCalled();
  });
});
