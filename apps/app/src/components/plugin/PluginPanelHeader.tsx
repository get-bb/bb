import { Component, type ReactNode } from "react";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";
import { PluginIcon } from "./PluginIcon";
import { PluginContext } from "./plugin-context";

/**
 * The plugin navPanel slices of the shared app header (AppPageHeader via
 * AppLayout's AppHeader): plugin panels get the SAME chrome as
 * Settings — logo + panel title in the header center, the
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

/** Header center for a plugin panel route: plugin logo + panel title. */
export function PluginPanelHeaderCenter({
  panel,
}: {
  panel: PluginNavPanelSlot;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <PluginIcon
        pluginId={panel.pluginId}
        icon={panel.icon}
        className="text-muted-foreground"
      />
      <p className="truncate text-sm font-semibold">{panel.title}</p>
    </div>
  );
}

/**
 * Header actions for a plugin panel route: the registration's
 * `headerContent`, in its own boundary. Null when the panel registers none
 * or uses `chrome: "none"` (the plugin owns the body wholesale there; the
 * shared header stays logo + title only).
 */
export function PluginPanelHeaderActions({
  panel,
  subPath,
}: {
  panel: PluginNavPanelSlot;
  subPath: string;
}) {
  const HeaderContent = panel.headerContent;
  if (HeaderContent === undefined || panel.chrome === "none") return null;
  return (
    <HeaderContentBoundary
      // Generation in the key: a P3.4 reload remounts the accessory with
      // fresh error-boundary state.
      key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
      pluginId={panel.pluginId}
    >
      <PluginContext.Provider value={panel.pluginId}>
        {/* data-bb-plugin-root: the accessory is plugin code, so the
            plugin's @scope'd stylesheet must apply here too. */}
        <div
          data-bb-plugin-root=""
          data-bb-plugin={panel.pluginId}
          className="flex shrink-0 items-center gap-2"
        >
          <HeaderContent subPath={subPath} />
        </div>
      </PluginContext.Provider>
    </HeaderContentBoundary>
  );
}
