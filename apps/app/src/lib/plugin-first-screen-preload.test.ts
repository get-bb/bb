// @vitest-environment jsdom

import type { InstalledPlugin } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginListQueryKey } from "@/hooks/queries/query-keys";
import { makeInstalledPlugin } from "@/test/fixtures/plugins";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { preloadFirstScreenPluginBundles } from "./plugin-first-screen-preload";

function installedPlugin(
  id: string,
  status: InstalledPlugin["status"],
  jsUrl: string,
): InstalledPlugin {
  return makeInstalledPlugin({
    id,
    status,
    app: {
      hasApp: true,
      bundle: {
        jsUrl,
        cssUrl: `${jsUrl}.css`,
        jsBytes: 1,
        hash: "h",
        sdkMajor: 0,
        sdkVersion: "0.1.0",
        compatible: true,
      },
    },
  });
}

afterEach(() => {
  localStorage.clear();
});

describe("preloadFirstScreenPluginBundles", () => {
  it("preloads only loadable bundles of the remembered first-screen owners", async () => {
    const { queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(pluginListQueryKey(true), [
      installedPlugin("thread-list", "running", "/thread-list.js"),
      installedPlugin("navigation", "starting", "/navigation.js"),
      installedPlugin("secrets", "running", "/secrets.js"),
    ]);
    const preload = vi.fn();

    await preloadFirstScreenPluginBundles({ preload, queryClient });

    expect(preload.mock.calls).toEqual([["/thread-list.js"]]);
  });
});
