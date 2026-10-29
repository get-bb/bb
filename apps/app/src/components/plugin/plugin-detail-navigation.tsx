import { useCallback } from "react";
import { LazyPluginDetailPaneView } from "@/views/ToolsViewSplits";
import {
  usePublishPluginDetailOpener,
  type PluginDetailOpener,
} from "./plugin-detail-opener";

export function PluginDetailTabContent({ detailKey }: { detailKey: string }) {
  return <LazyPluginDetailPaneView pluginId={detailKey} />;
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
