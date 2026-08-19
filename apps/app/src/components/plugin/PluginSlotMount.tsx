import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pill } from "@bb/shared-ui/pill";
import {
  PluginContext,
  PluginSlotOwnershipContext,
  type PluginSlotOwnershipRegistry,
} from "./plugin-context";

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
const ownedStateReleasesBySlotInstance = new Map<
  string,
  Map<symbol, () => void>
>();

function registerSlotOwnedState(
  instanceKey: string,
  owner: symbol,
  release: () => void,
): void {
  let releases = ownedStateReleasesBySlotInstance.get(instanceKey);
  if (!releases) {
    releases = new Map();
    ownedStateReleasesBySlotInstance.set(instanceKey, releases);
  }
  releases.set(owner, release);
}

function unregisterSlotOwnedState(instanceKey: string, owner: symbol): void {
  const releases = ownedStateReleasesBySlotInstance.get(instanceKey);
  releases?.delete(owner);
  if (releases?.size === 0) {
    ownedStateReleasesBySlotInstance.delete(instanceKey);
  }
}

function releaseSlotInstanceOwnedState(instanceKey: string): void {
  const releases = [
    ...(ownedStateReleasesBySlotInstance.get(instanceKey)?.values() ?? []),
  ];
  ownedStateReleasesBySlotInstance.delete(instanceKey);
  for (const release of releases) release();
}

export function pluginSlotInstanceKey(
  pluginId: string,
  slotKind: string,
  slotId: string,
  /**
   * Discriminates concurrent mounts of ONE slot — the thread header renders a
   * control per split pane. Without it a crash in one pane would disable the
   * control in every pane and release their owned state too.
   */
  instanceId?: string,
): string {
  const base = `${pluginId}/${slotKind}/${slotId}`;
  return instanceId === undefined ? base : `${base}/${instanceId}`;
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
  fallback?: ReactNode;
  onCrash?: (pluginId: string) => void;
}

interface PluginSlotBoundaryState {
  crashed: boolean;
}

class PluginSlotBoundary extends Component<
  PluginSlotBoundaryProps,
  PluginSlotBoundaryState
> {
  private readonly ownedStateReleases = new Map<symbol, () => void>();

  private readonly ownershipRegistry: PluginSlotOwnershipRegistry = {
    register: (owner, release) => {
      this.ownedStateReleases.set(owner, release);
      registerSlotOwnedState(this.props.instanceKey, owner, release);
    },
    unregister: (owner) => {
      this.ownedStateReleases.delete(owner);
      unregisterSlotOwnedState(this.props.instanceKey, owner);
    },
  };

  constructor(props: PluginSlotBoundaryProps) {
    super(props);
    this.state = { crashed: crashedSlotInstances.has(props.instanceKey) };
  }

  static getDerivedStateFromError(): PluginSlotBoundaryState {
    return { crashed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    releaseSlotInstanceOwnedState(this.props.instanceKey);
    this.ownedStateReleases.clear();
    crashedSlotInstances.add(this.props.instanceKey);
    console.warn(
      `[plugin:${this.props.pluginId}] slot "${this.props.instanceKey}" crashed and is disabled for this session: ${error.message}`,
      info.componentStack,
    );
    // Contained like the render itself: a throwing notifier must not turn a
    // recovered slot into an unrecoverable one.
    try {
      this.props.onCrash?.(this.props.pluginId);
    } catch (notifyError) {
      console.warn(
        `[plugin:${this.props.pluginId}] slot crash notifier failed`,
        notifyError,
      );
    }
  }

  override componentWillUnmount(): void {
    this.releaseOwnedState();
  }

  private releaseOwnedState(): void {
    const entries = [...this.ownedStateReleases.entries()];
    this.ownedStateReleases.clear();
    for (const [owner, release] of entries) {
      unregisterSlotOwnedState(this.props.instanceKey, owner);
      release();
    }
  }

  override render(): ReactNode {
    if (
      this.state.crashed ||
      crashedSlotInstances.has(this.props.instanceKey)
    ) {
      return (
        this.props.fallback ?? (
          <CrashedPluginChip pluginId={this.props.pluginId} />
        )
      );
    }
    return (
      <PluginSlotOwnershipContext.Provider value={this.ownershipRegistry}>
        {this.props.children}
      </PluginSlotOwnershipContext.Provider>
    );
  }
}

export interface PluginSlotMountProps {
  pluginId: string;
  /** e.g. "homepageSection", "navPanel" — combined with slotId per instance. */
  slotKind: string;
  slotId: string;
  children: ReactNode;
  crashFallback?: ReactNode;
  /**
   * Discriminates concurrent mounts of one slot so their crash state stays
   * independent (see {@link pluginSlotInstanceKey}). Omit for slots that mount
   * once, where a crash should disable the slot everywhere.
   */
  instanceId?: string;
  /**
   * Called once when this instance crashes. For slots whose fallback is
   * silent host UI (the sidebar's built-in thread list), where the user would
   * otherwise see the plugin simply vanish.
   */
  onCrash?: (pluginId: string) => void;
}

/**
 * The wrapper around every mounted plugin slot component: provides the
 * plugin id to the SDK hooks and contains crashes to this instance.
 *
 * The `data-bb-plugin={pluginId}` element is the scoping root for the
 * plugin's compiled stylesheet — `bb plugin build` prefixes every utility
 * selector with `:where([data-bb-plugin="<id>"], …)`, so plugin CSS can never leak
 * onto host elements or another plugin's pane (`data-bb-plugin-root` stays
 * for stylesheets built before the per-plugin scope). `display: contents`
 * keeps the wrapper layout-neutral.
 */
export function PluginSlotMount({
  pluginId,
  slotKind,
  slotId,
  children,
  crashFallback,
  instanceId,
  onCrash,
}: PluginSlotMountProps) {
  return (
    <PluginContext.Provider value={pluginId}>
      <PluginSlotBoundary
        pluginId={pluginId}
        instanceKey={pluginSlotInstanceKey(
          pluginId,
          slotKind,
          slotId,
          instanceId,
        )}
        fallback={crashFallback}
        {...(onCrash ? { onCrash } : {})}
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
