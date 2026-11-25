// @vitest-environment jsdom
import { APP_SHELL_PLUGIN_LIST_ELEMENT_ID } from "@bb/server-contract";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginListQueryOptions } from "@/hooks/queries/plugin-settings-queries";
import { pluginListQueryKey } from "@/hooks/queries/query-keys";
import { makeInstalledPlugin } from "@/test/fixtures/plugins";
import { seedPluginListFromAppShell } from "./app-shell-plugin-list";
import { fetchFrontendCandidates } from "./plugin-frontend";

const composer = makeInstalledPlugin({
  id: "bb--composer",
  app: {
    hasApp: true,
    bundle: {
      jsUrl: "/api/v1/plugin-app-assets/0123456789abcdef/app.js",
      cssUrl: null,
      jsBytes: 1_000,
      hash: "0123456789abcdef",
      sdkMajor: 0,
      sdkVersion: "0.4.27",
      compatible: true,
      runtimeSlots: ["zod"],
    },
  },
});

function shellDocument(text: string): Document {
  const doc = document.implementation.createHTMLDocument("bb");
  const script = doc.createElement("script");
  script.type = "application/json";
  script.id = APP_SHELL_PLUGIN_LIST_ELEMENT_ID;
  script.textContent = text;
  doc.head.append(script);
  return doc;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("seedPluginListFromAppShell", () => {
  it("lets plugin boot start from the shell's list while the connect refresh is still in flight", async () => {
    const queryClient = new QueryClient();
    const doc = shellDocument(JSON.stringify({ plugins: [composer] }));
    const networkFetch = vi.fn<typeof fetch>(() => new Promise(() => {}));
    vi.stubGlobal("fetch", networkFetch);

    seedPluginListFromAppShell(queryClient, doc, Date.now() - 1_000);
    void queryClient.invalidateQueries({ queryKey: pluginListQueryKey(true) });
    void queryClient.prefetchQuery({
      ...pluginListQueryOptions({ enabled: true }),
      staleTime: 0,
    });

    await expect(
      fetchFrontendCandidates(queryClient, "reuse-cached"),
    ).resolves.toEqual({
      candidates: [{ pluginId: "bb--composer", bundle: composer.app.bundle }],
      startingPluginIds: [],
    });
    expect(networkFetch).toHaveBeenCalledTimes(1);
    expect(doc.getElementById(APP_SHELL_PLUGIN_LIST_ELEMENT_ID)).toBeNull();
  });

  it("leaves the list to the network when the shell's copy does not parse", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const queryClient = new QueryClient();

    seedPluginListFromAppShell(
      queryClient,
      shellDocument(JSON.stringify({ plugins: [{ id: "partial" }] })),
      Date.now(),
    );

    expect(queryClient.getQueryData(pluginListQueryKey(true))).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
