import { usePageTitleValue } from "@/components/layout/page-title";
import { PageTitleHeader } from "@/components/layout/PageTitleHeader";
import { Component, type ReactNode } from "react";
import type { PluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";
import { usePluginCss } from "@/lib/plugin-css";
import { PluginItemIcon } from "./PluginIcon";
import { PluginContext } from "./plugin-context";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import { getPluginPagePanelStateId } from "./plugin-page-panel-state";

class HeaderContentBoundary extends Component<
  {
    pluginId: string;
    slotName: "headerContent" | "experimental_headerTitle";
    fallback: ReactNode;
    children: ReactNode;
  },
  { crashed: boolean }
> {
  override state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  override componentDidCatch(error: Error): void {
    console.warn(
      `[plugin:${this.props.pluginId}] navPanel ${this.props.slotName} crashed and is hidden: ${error.message}`,
    );
  }

  override render(): ReactNode {
    return this.state.crashed ? this.props.fallback : this.props.children;
  }
}

export function PluginPanelHeaderCenter({
  chrome,
  panel,
  subPath,
}: {
  chrome: Pick<PluginNavPanelChrome, "pluginId" | "icon" | "title">;
  panel: PluginNavPanelSlot | undefined;
  subPath: string;
}) {
  const HeaderTitle = panel?.experimental_headerTitle;
  usePluginCss(HeaderTitle === undefined ? null : chrome.pluginId);
  const defaultCenter = <DefaultPluginPanelHeaderCenter chrome={chrome} />;
  if (panel === undefined || HeaderTitle === undefined) return defaultCenter;
  return (
    <HeaderContentBoundary
      key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
      pluginId={panel.pluginId}
      slotName="experimental_headerTitle"
      fallback={defaultCenter}
    >
      <PluginContext.Provider value={panel.pluginId}>
        <div
          data-bb-plugin-root=""
          data-bb-plugin={panel.pluginId}
          className="flex min-w-0 flex-1 items-center"
        >
          <HeaderTitle subPath={subPath} />
        </div>
      </PluginContext.Provider>
    </HeaderContentBoundary>
  );
}

function DefaultPluginPanelHeaderCenter({
  chrome,
}: {
  chrome: Pick<PluginNavPanelChrome, "pluginId" | "icon" | "title">;
}) {
  const pageTitle = usePageTitleValue();
  return (
    <PageTitleHeader
      icon={
        <PluginItemIcon
          pluginId={chrome.pluginId}
          icon={chrome.icon}
          className="text-muted-foreground"
        />
      }
      title={chrome.title}
      value={pageTitle}
    />
  );
}

export function PluginPanelHeaderActions({
  panel,
  paneId,
  subPath,
  paneActions,
}: {
  panel: PluginNavPanelSlot;
  paneId?: string;
  subPath: string;
  paneActions?: ReactNode;
}) {
  const paneContext = useOptionalPaneContext();
  const HeaderContent = panel.headerContent;
  usePluginCss(HeaderContent === undefined ? null : panel.pluginId);
  const panelStateId = getPluginPagePanelStateId({
    panelPath: panel.path,
    paneId: paneId ?? paneContext?.paneId,
    pluginId: panel.pluginId,
  });
  return (
    <div className="flex shrink-0 items-center gap-2">
      {HeaderContent === undefined ? null : (
        <HeaderContentBoundary
          key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
          pluginId={panel.pluginId}
          slotName="headerContent"
          fallback={null}
        >
          <PluginContext.Provider value={panel.pluginId}>
            <div
              data-bb-plugin-root=""
              data-bb-plugin={panel.pluginId}
              className="flex shrink-0 items-center gap-2"
            >
              <HeaderContent subPath={subPath} />
            </div>
          </PluginContext.Provider>
        </HeaderContentBoundary>
      )}
      {paneActions}
      <div data-plugin-right-panel-toggle-portal={panelStateId} />
    </div>
  );
}
