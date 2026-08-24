import { Component, type ReactNode } from "react";
import type { PluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";
import { usePluginCss } from "@/lib/plugin-css";
import { PluginIcon } from "./PluginIcon";
import { PluginContext } from "./plugin-context";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import { getPluginPagePanelStateId } from "./plugin-page-panel-state";

/**
 * The plugin navPanel slices of the shared app header (AppPageHeader via
 * AppLayout's AppHeader): plugin panels get the SAME chrome as
 * Settings — compact plugin icon + panel title in the header center, the
 * registration's optional `headerContent` component in the header actions.
 * PluginPanelView renders only the panel body.
 */

/**
 * Containment for `headerContent`: plugin code inside host chrome. A throw
 * hides the accessory (warn only) — never the header itself or the panel
 * body, whose own boundary latch stays untouched.
 */
class HeaderContentBoundary extends Component<
  { pluginId: string; children: ReactNode },
  { crashed: boolean }
> {
  override state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  override componentDidCatch(error: Error): void {
    console.warn(
      `[plugin:${this.props.pluginId}] navPanel headerContent crashed and is hidden: ${error.message}`,
    );
  }

  override render(): ReactNode {
    return this.state.crashed ? null : this.props.children;
  }
}

/**
 * Header center for a plugin panel route: compact plugin icon + panel title.
 * Takes only the panel's chrome so it can paint from a live registration or
 * from the chrome remembered before plugin frontends have booted.
 */
export function PluginPanelHeaderCenter({
  chrome,
}: {
  chrome: Pick<PluginNavPanelChrome, "pluginId" | "icon" | "title">;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <PluginIcon
        pluginId={chrome.pluginId}
        icon={chrome.icon}
        className="text-muted-foreground"
      />
      <p className="truncate text-sm font-semibold">{chrome.title}</p>
    </div>
  );
}

/**
 * Header actions for a plugin panel route: the registration's
 * `headerContent`, in its own boundary. Every panel uses this shared title bar
 * while its component owns the full-bleed body below.
 */
export function PluginPanelHeaderActions({
  panel,
  paneId,
  subPath,
}: {
  panel: PluginNavPanelSlot;
  paneId?: string;
  subPath: string;
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
          // Generation in the key: a P3.4 reload remounts the accessory with
          // fresh error-boundary state.
          key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
          pluginId={panel.pluginId}
        >
          <PluginContext.Provider value={panel.pluginId}>
            {/* data-bb-plugin-root: the accessory is plugin code, so the
                plugin's scoped stylesheet must apply here too. */}
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
      <div data-plugin-right-panel-toggle-portal={panelStateId} />
    </div>
  );
}
