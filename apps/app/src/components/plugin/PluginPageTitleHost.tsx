import type { ReactNode } from "react";
import {
  PageTitleHookHost,
  PageTitleProvider,
} from "@/components/layout/page-title";
import { usePluginSlots } from "@/lib/plugin-slots";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import { PluginSlotMount } from "./PluginSlotMount";

export function PluginPageTitleHost({
  pluginId,
  panelPath,
  subPath,
  children,
  focused = true,
}: {
  pluginId: string;
  panelPath: string;
  subPath: string;
  children: ReactNode;
  focused?: boolean;
}) {
  const { navPanels } = usePluginSlots();
  const pane = useOptionalPaneContext();
  const panel = navPanels.find(
    (candidate) =>
      candidate.pluginId === pluginId && candidate.path === panelPath,
  );
  const fallback = (
    <PageTitleProvider value={null} focused={focused}>
      {children}
    </PageTitleProvider>
  );
  if (!panel?.experimental_usePageTitle) return fallback;
  return (
    <PluginSlotMount
      key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
      pluginId={pluginId}
      wrapRoot={false}
      slotKind="navPanelPageTitle"
      slotId={panel.id}
      instanceId={pane?.paneId ?? "page"}
      crashResetKey={`${panel.generation}:${subPath}`}
      crashFallback={fallback}
    >
      <PageTitleHookHost
        usePageTitle={panel.experimental_usePageTitle}
        subPath={subPath}
        focused={focused}
      >
        {children}
      </PageTitleHookHost>
    </PluginSlotMount>
  );
}
