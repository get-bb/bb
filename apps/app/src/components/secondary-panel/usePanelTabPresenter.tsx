import { useCallback, type ReactNode } from "react";
import type { TerminalSession } from "@bb/server-contract";
import { getEnvironmentFilePreviewSourceRef } from "@bb/client-core";
import { COARSE_POINTER_COMPACT_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { PluginIcon, PluginItemIcon } from "@/components/plugin/PluginIcon";
import { resolvePluginDetailKey } from "@/components/plugin/management/installed-plugin-catalog";
import { usePluginCatalogSearch } from "@/hooks/queries/plugin-catalog-queries";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import { getBrowserUrlHost } from "@/lib/browser-url";
import type { SecondaryFileFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { BrowserTabIcon } from "./BrowserTabIcon";
import { RightPanelFileTabIcon } from "./RightPanelFileTabIcon";

export interface PanelTabPresentation {
  contentFillsRegion: boolean;
  isPinned: boolean;
  label: string;
  leadingVisual: ReactNode;
  statusLabel: string | null;
}

interface PanelTabPluginAction {
  pluginId: string;
  id: string;
  icon?: string | null;
  layout?: "padded" | "flush";
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

export function usePanelTabPresenter({
  tabs,
  terminalsById,
  pluginActions,
}: {
  tabs: readonly SecondaryFileFixedPanelTab[];
  terminalsById: ReadonlyMap<string, TerminalSession>;
  pluginActions: readonly PanelTabPluginAction[];
}): (tab: SecondaryFileFixedPanelTab) => PanelTabPresentation {
  const hasDetailTabs = tabs.some((tab) => tab.kind === "plugin-detail");
  const plugins = usePluginList({ enabled: hasDetailTabs }).data?.plugins;
  const entries = usePluginCatalogSearch("", { enabled: hasDetailTabs }).data
    ?.entries;
  return useCallback(
    (tab) => {
      switch (tab.kind) {
        case "browser": {
          const label =
            tab.title ?? (tab.url.length > 0 ? getBrowserUrlHost(tab.url) : "");
          return {
            contentFillsRegion: false,
            isPinned: false,
            label: label.length > 0 ? label : "Browser",
            leadingVisual: (
              <BrowserTabIcon
                tabId={tab.id}
                className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
              />
            ),
            statusLabel: null,
          };
        }
        case "terminal": {
          const session = terminalsById.get(tab.terminalId);
          return {
            contentFillsRegion: false,
            isPinned: false,
            label: session?.title ?? "Terminal",
            leadingVisual: (
              <Icon
                name="Terminal"
                className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                aria-hidden
              />
            ),
            statusLabel:
              session === undefined || session.status === "running"
                ? null
                : session.status,
          };
        }
        case "workspace-file-preview":
        case "host-file-preview":
        case "thread-storage-file-preview":
          return {
            contentFillsRegion: false,
            isPinned:
              tab.kind === "thread-storage-file-preview" && tab.isPinned,
            label: fileName(tab.path),
            leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
            statusLabel:
              tab.kind === "workspace-file-preview"
                ? getEnvironmentFilePreviewSourceRef(tab.source)
                : null,
          };
        case "attachment-file-preview":
          return {
            contentFillsRegion: false,
            isPinned: false,
            label: tab.name,
            leadingVisual: <RightPanelFileTabIcon path={tab.name} />,
            statusLabel: null,
          };
        case "new-tab":
          return {
            contentFillsRegion: false,
            isPinned: false,
            label: "New tab",
            leadingVisual: (
              <Icon
                name="NewTab"
                className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                aria-hidden
              />
            ),
            statusLabel: null,
          };
        case "plugin-panel": {
          const action = pluginActions.find(
            (candidate) =>
              candidate.pluginId === tab.pluginId &&
              candidate.id === tab.actionId,
          );
          return {
            contentFillsRegion:
              tab.fileOpenerOwner !== undefined || action?.layout === "flush",
            isPinned: false,
            label: tab.title,
            leadingVisual: (
              <PluginItemIcon
                pluginId={tab.pluginId}
                icon={action?.icon ?? null}
                className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
              />
            ),
            statusLabel: null,
          };
        }
        case "plugin-detail": {
          const { plugin, entry } = resolvePluginDetailKey(
            tab.detailKey,
            plugins ?? [],
            entries ?? [],
          );
          return {
            contentFillsRegion: true,
            isPinned: false,
            label: entry?.displayName ?? plugin?.name ?? tab.title,
            leadingVisual: (
              <PluginIcon
                pluginId={plugin?.id ?? entry?.pluginId ?? tab.detailKey}
                icon={entry?.icon ?? plugin?.icon ?? null}
                compactIconUrl={plugin?.compactIconUrl}
                className="size-3.5"
              />
            ),
            statusLabel: null,
          };
        }
      }
    },
    [entries, pluginActions, plugins, terminalsById],
  );
}
