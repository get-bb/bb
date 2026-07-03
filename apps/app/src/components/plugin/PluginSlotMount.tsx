import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pill } from "@/components/ui/pill";
import { PluginContext } from "./plugin-context";

/**
 * Per-plugin error containment for mounted slot components (plugin design
 * §5.1): a throw inside one plugin's slot collapses that mount to a small
 * "plugin <id> crashed" chip and disables that slot instance for the rest of
 * the session (crossing routes/remounts), leaving every other slot and
 * plugin untouched.
 */

// Slot instances disabled for this session, keyed by `pluginId`. A crash in
// one instance disables that instance everywhere it mounts (same key).
const crashedSlotInstances = new Set<string>();

export function pluginSlotInstanceKey(
  pluginId: string,
  slotKind: string,
  slotId: string,
): string {
  return `${pluginId}/${slotKind}/${slotId}`;
}

/**
 * Re-enable a plugin's crashed slot instances (P3.4 calls this on plugin
 * reload so a fixed plugin gets a fresh chance). Already-mounted boundaries
 * that crashed keep their fallback until remounted — reload replaces the
 * registrations (new component identities), which remounts them.
 */
export function resetCrashedPluginSlots(pluginId: string): void {
  const prefix = `${pluginId}/`;
  for (const key of [...crashedSlotInstances]) {
    if (key.startsWith(prefix)) crashedSlotInstances.delete(key);
  }
}

/** Test-only. */
export function resetAllCrashedPluginSlotsForTest(): void {
  crashedSlotInstances.clear();
}

function CrashedPluginChip({ pluginId }: { pluginId: string }) {
  return (
    <Pill variant="outline" className="text-muted-foreground">
      plugin {pluginId} crashed
    </Pill>
  );
}

interface PluginSlotBoundaryProps {
  pluginId: string;
  instanceKey: string;
  children: ReactNode;
}

interface PluginSlotBoundaryState {
  crashed: boolean;
}

class PluginSlotBoundary extends Component<
  PluginSlotBoundaryProps,
  PluginSlotBoundaryState
> {
  constructor(props: PluginSlotBoundaryProps) {
    super(props);
    this.state = { crashed: crashedSlotInstances.has(props.instanceKey) };
  }

  static getDerivedStateFromError(): PluginSlotBoundaryState {
    return { crashed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    crashedSlotInstances.add(this.props.instanceKey);
    console.warn(
      `[plugin:${this.props.pluginId}] slot "${this.props.instanceKey}" crashed and is disabled for this session: ${error.message}`,
      info.componentStack,
    );
  }

  override render(): ReactNode {
    if (this.state.crashed || crashedSlotInstances.has(this.props.instanceKey)) {
      return <CrashedPluginChip pluginId={this.props.pluginId} />;
    }
    return this.props.children;
  }
}

export interface PluginSlotMountProps {
  pluginId: string;
  /** e.g. "homepageSection", "navPanel" — combined with slotId per instance. */
  slotKind: string;
  slotId: string;
  children: ReactNode;
}

/**
 * The wrapper around every mounted plugin slot component: provides the
 * plugin id to the SDK hooks and contains crashes to this instance.
 *
 * The `data-bb-plugin-root` element is the scoping root for the plugin's
 * compiled stylesheet — `bb plugin build` wraps every utility rule in
 * `@scope ([data-bb-plugin-root])`, so plugin CSS can never leak onto host
 * elements. `display: contents` keeps the wrapper layout-neutral.
 */
export function PluginSlotMount({
  pluginId,
  slotKind,
  slotId,
  children,
}: PluginSlotMountProps) {
  return (
    <PluginContext.Provider value={pluginId}>
      <PluginSlotBoundary
        pluginId={pluginId}
        instanceKey={pluginSlotInstanceKey(pluginId, slotKind, slotId)}
      >
        <div
          data-bb-plugin-root=""
          data-bb-plugin={pluginId}
          className="contents"
        >
          {children}
        </div>
      </PluginSlotBoundary>
    </PluginContext.Provider>
  );
}
