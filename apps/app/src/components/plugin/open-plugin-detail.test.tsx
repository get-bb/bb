// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginCatalogSearchData } from "@/hooks/queries/plugin-catalog-queries";
import {
  pluginCatalogSearchQueryKey,
  pluginListQueryKey,
} from "@/hooks/queries/query-keys";
import { makeInstalledPlugin } from "@/test/fixtures/plugins";
import { openPluginDetail } from "./open-plugin-detail";
import {
  usePublishPluginDetailOpener,
  type PluginDetailOpener,
} from "./plugin-detail-opener";

function Workspace({ open }: { open: PluginDetailOpener }) {
  usePublishPluginDetailOpener(open, true);
  return null;
}

function catalogData(
  entries: { pluginId: string; displayName: string }[],
): PluginCatalogSearchData {
  return {
    entries: entries.map(({ pluginId, displayName }) => ({
      entryId: pluginId,
      pluginId,
      displayName,
      description: `${displayName} description`,
      icon: "Zap",
      iconUrl: null,
      iconTinted: false,
      screenshots: [],
      collections: [],
      source: `npm:${pluginId}`,
      repositoryUrl: null,
      marketplace: "bb-community",
      marketplaceDisplayName: "BB Community",
      publisherKey: "bb-community",
      publisherLabel: "BB Community",
      official: true,
      author: null,
      installed: false,
      conflictingInstallSource: null,
      installedByDefault: false,
      installs: null,
      compatible: true,
      incompatibleReason: null,
    })),
    collections: [],
    categories: [],
  };
}

afterEach(cleanup);

describe("openPluginDetail", () => {
  it("opens the focused workspace's detail tab titled from the installed plugin", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(pluginListQueryKey(true), [
      makeInstalledPlugin({ id: "docs", name: "Docs" }),
    ]);
    queryClient.setQueryData(
      pluginCatalogSearchQueryKey(""),
      catalogData([{ pluginId: "docs", displayName: "Catalog docs" }]),
    );
    const open = vi.fn<PluginDetailOpener>(() => true);
    const navigate = vi.fn();
    render(<Workspace open={open} />);

    expect(openPluginDetail({ pluginId: "docs", queryClient, navigate })).toBe(
      true,
    );

    expect(open).toHaveBeenCalledWith({ pluginId: "docs", title: "Docs" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("titles a store-only plugin from any cached catalog search, then from its id", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      pluginCatalogSearchQueryKey("browser"),
      catalogData([
        { pluginId: "browser-automation", displayName: "Browser Automation" },
      ]),
    );
    const open = vi.fn<PluginDetailOpener>(() => true);
    render(<Workspace open={open} />);

    openPluginDetail({
      pluginId: " browser-automation ",
      queryClient,
      navigate: vi.fn(),
    });
    openPluginDetail({ pluginId: "uncached", queryClient, navigate: vi.fn() });

    expect(open.mock.calls).toEqual([
      [{ pluginId: "browser-automation", title: "Browser Automation" }],
      [{ pluginId: "uncached", title: "uncached" }],
    ]);
  });

  it("falls back to the full plugin page when no workspace accepts the tab", () => {
    const navigate = vi.fn();
    render(<Workspace open={() => false} />);

    expect(
      openPluginDetail({
        pluginId: "team/plugin",
        queryClient: new QueryClient(),
        navigate,
      }),
    ).toBe(true);

    expect(navigate).toHaveBeenCalledWith("/plugins/team%2Fplugin");
  });

  it("declines an empty id without opening or navigating", () => {
    const open = vi.fn<PluginDetailOpener>(() => true);
    const navigate = vi.fn();
    render(<Workspace open={open} />);

    expect(
      openPluginDetail({
        pluginId: "  ",
        queryClient: new QueryClient(),
        navigate,
      }),
    ).toBe(false);

    expect(open).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
