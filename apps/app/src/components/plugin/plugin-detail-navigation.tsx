import { useCallback } from "react";
import { PluginIcon } from "./PluginIcon";
import { resolvePluginDetailKey } from "./management/installed-plugin-catalog";
import type {
  FixedPanelTab,
  PluginDetailFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import type { SecondaryPanelRenderableTab } from "@/components/secondary-panel/secondaryPanelTab";
import { usePluginCatalogSearch } from "@/hooks/queries/plugin-catalog-queries";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import { LazyPluginDetailPaneView } from "@/views/ToolsViewSplits";
import {
  usePublishPluginDetailOpener,
  type PluginDetailOpener,
} from "./plugin-detail-opener";

export function PluginDetailTabContent({ detailKey }: { detailKey: string }) {
  return <LazyPluginDetailPaneView pluginId={detailKey} />;
}

export interface PluginDetailRenderableTabArgs {
  tab: PluginDetailFixedPanelTab;
  onSelect: () => void;
  onClose: () => void;
}

export function usePluginDetailRenderableTab(
  tabs: readonly FixedPanelTab[],
): (args: PluginDetailRenderableTabArgs) => SecondaryPanelRenderableTab {
  const hasDetailTabs = tabs.some((tab) => tab.kind === "plugin-detail");
  const plugins = usePluginList({ enabled: hasDetailTabs }).data?.plugins;
  const entries = usePluginCatalogSearch("", { enabled: hasDetailTabs }).data
    ?.entries;
  return useCallback(
    ({ tab, onSelect, onClose }) => {
      const { plugin, entry } = resolvePluginDetailKey(
        tab.detailKey,
        plugins ?? [],
        entries ?? [],
      );
      return {
        contentFillsRegion: true,
        label: entry?.displayName ?? plugin?.name ?? tab.title,
        leadingVisual: (
          <PluginIcon
            pluginId={plugin?.id ?? entry?.pluginId ?? tab.detailKey}
            icon={entry?.icon ?? plugin?.icon ?? null}
            compactIconUrl={plugin?.compactIconUrl}
            className="size-3.5"
          />
        ),
        onClose,
        onSelect,
        renderContent: () => (
          <PluginDetailTabContent detailKey={tab.detailKey} />
        ),
        statusLabel: null,
        tab,
      };
    },
    [entries, plugins],
  );
}

export function usePluginDetailTabOpener(
  open: (detail: { detailKey: string; title: string }) => void,
  isFocused: boolean,
): void {
  const opener = useCallback<PluginDetailOpener>(
    (destination) => {
      open({ detailKey: destination.pluginId, title: destination.title });
      return true;
    },
    [open],
  );
  usePublishPluginDetailOpener(opener, isFocused);
}
